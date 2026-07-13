#!/usr/bin/env python3
"""
Danny Widget Bridge — Pipe A + push (v0.3).

Inbound:    backend POSTs buyer turns here     (BRIDGE_AUTH_TOKEN)
Push:       bridge POSTs each turn to Danny    (BRIDGE_PUSH_TOKEN, MC→Danny direction)
Reply in:   Danny POSTs reply here             (BRIDGE_POLL_TOKEN, Danny→MC direction)
Forward:    bridge POSTs reply to backend      (BRIDGE_BACKEND_REPLY_TOKEN, MC→backend)

The pull surface (GET /pending, POST /ack, POST /release) is kept as an
undocumented Phase-1 fallback; production consumer is the push pattern.

Contract honoured:
  - Backend inbound shape unchanged from v0.1; still returns 202.
  - Backend reply shape: {conversation_id, reply, message_id?, trace_id?, finished_at?}.
    Idempotency key on backend is (conversation_id, message_id); bridge uses a stable
    message_id from inbound, reused across every retry.
  - On 2xx → done, 401 → don't retry (log alarm), 5xx/timeout → retry with backoff.
  - conversation_id prefixed "synthetic-" still flows; backend auto-acks.
  - Push to Danny: POST {BRIDGE_PUSH_URL} with the leased payload shape; same backoff.

Storage: SQLite WAL at /var/lib/danny-widget-bridge/queue.db (+ JSONL audit unchanged).
Dormant degradations: empty BRIDGE_BACKEND_REPLY_TOKEN → reply forwarder no-ops;
empty BRIDGE_PUSH_TOKEN → push thread no-ops (replies still accepted via /reply).
"""
from __future__ import annotations

import contextlib
import hmac
import json
import logging
import os
import secrets
import signal
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from typing import Any, Iterable

# ─── Config ────────────────────────────────────────────────────────────────
BIND_HOST                = os.environ.get("BRIDGE_BIND_HOST", "10.50.0.1")
BIND_PORT                = int(os.environ.get("BRIDGE_BIND_PORT", "8089"))
AUTH_TOKEN               = os.environ.get("BRIDGE_AUTH_TOKEN", "")
POLL_TOKEN               = os.environ.get("BRIDGE_POLL_TOKEN", "")
AUDIT_PATH               = os.environ.get("BRIDGE_AUDIT_PATH", "/var/log/danny-widget-bridge/inbound.jsonl")
QUEUE_DB                 = os.environ.get("BRIDGE_QUEUE_DB", "/var/lib/danny-widget-bridge/queue.db")
BACKEND_REPLY_URL        = os.environ.get("BRIDGE_BACKEND_REPLY_URL", "http://10.50.0.4:8000/v1/webhooks/danny-reply")
BACKEND_REPLY_TOKEN      = os.environ.get("BRIDGE_BACKEND_REPLY_TOKEN", "")
PUSH_URL                 = os.environ.get("BRIDGE_PUSH_URL", "http://10.50.0.2:18790/web/inbound")
PUSH_TOKEN               = os.environ.get("BRIDGE_PUSH_TOKEN", "")
PUSH_RETRY_MAX_ATTEMPTS  = int(os.environ.get("BRIDGE_PUSH_RETRY_MAX_ATTEMPTS", "5"))
PUSH_TIMEOUT_SECS        = int(os.environ.get("BRIDGE_PUSH_TIMEOUT_SECS", "10"))
PUSHER_INTERVAL          = int(os.environ.get("BRIDGE_PUSHER_INTERVAL", "2"))
LEASE_SECS_DEFAULT       = int(os.environ.get("BRIDGE_LEASE_SECS_DEFAULT", "60"))
LEASE_MAX_ATTEMPTS       = int(os.environ.get("BRIDGE_LEASE_MAX_ATTEMPTS", "5"))
REPLY_RETRY_MAX_ATTEMPTS = int(os.environ.get("BRIDGE_REPLY_RETRY_MAX_ATTEMPTS", "5"))
REPLY_TIMEOUT_SECS       = int(os.environ.get("BRIDGE_REPLY_TIMEOUT_SECS", "10"))
LEASE_EXPIRER_INTERVAL   = int(os.environ.get("BRIDGE_LEASE_EXPIRER_INTERVAL", "10"))
FORWARDER_INTERVAL       = int(os.environ.get("BRIDGE_FORWARDER_INTERVAL", "5"))
MAX_BODY_BYTES           = 64 * 1024
REQUIRED_INBOUND_FIELDS  = ("binding", "mode", "conversation_id", "message")
EXPECTED_BINDING         = "web:danny-widget"
RETRY_BACKOFF_SECS       = (1, 5, 15, 60, 300)

# ─── Logging ───────────────────────────────────────────────────────────────
logger = logging.getLogger("danny-widget-bridge")
logger.setLevel(logging.INFO)
_h = logging.StreamHandler(sys.stdout)
_h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_h)

_audit_logger = logging.getLogger("danny-widget-bridge.audit")
_audit_logger.setLevel(logging.INFO)
_audit_logger.propagate = False
_audit_handler = RotatingFileHandler(AUDIT_PATH, maxBytes=10 * 1024 * 1024, backupCount=5)
_audit_handler.setFormatter(logging.Formatter("%(message)s"))
_audit_logger.addHandler(_audit_handler)


# ─── Queue ─────────────────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_messages (
  message_id            TEXT PRIMARY KEY,
  received_at           INTEGER NOT NULL,
  binding               TEXT NOT NULL,
  mode                  TEXT NOT NULL,
  conversation_id       TEXT NOT NULL,
  contact_id            TEXT,
  authenticated         INTEGER NOT NULL,
  trace_id              TEXT,
  message               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  leased_at             INTEGER,
  leased_until          INTEGER,
  leased_by             TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  done_at               INTEGER,
  reply_text            TEXT,
  reply_finished_at     TEXT,
  reply_trace_id        TEXT,
  reply_forwarded       INTEGER NOT NULL DEFAULT 0,
  reply_attempts        INTEGER NOT NULL DEFAULT 0,
  reply_status          TEXT,
  reply_next_attempt_at INTEGER,
  reply_last_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_messages(status, received_at);
CREATE INDEX IF NOT EXISTS idx_pending_conv   ON pending_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_reply_pending  ON pending_messages(reply_forwarded, reply_next_attempt_at);
"""


PUSH_COLUMNS = (
    ("delivered",                "INTEGER NOT NULL DEFAULT 0"),
    ("delivered_at",             "INTEGER"),
    ("delivery_attempts",        "INTEGER NOT NULL DEFAULT 0"),
    ("delivery_next_attempt_at", "INTEGER"),
    ("delivery_status",          "TEXT"),
    ("delivery_last_error",      "TEXT"),
)


class Queue:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        with self._conn() as c:
            c.executescript("PRAGMA journal_mode=WAL;\nPRAGMA synchronous=NORMAL;")
            c.executescript(SCHEMA)
            existing = {r[1] for r in c.execute("PRAGMA table_info(pending_messages)").fetchall()}
            for col, ddl in PUSH_COLUMNS:
                if col not in existing:
                    c.execute(f"ALTER TABLE pending_messages ADD COLUMN {col} {ddl}")
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_push_pending "
                "ON pending_messages(status, delivered, delivery_next_attempt_at)"
            )

    @contextlib.contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=10.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def insert_inbound(self, *, message_id: str, received_at: int, binding: str,
                       mode: str, conversation_id: str, contact_id: str | None,
                       authenticated: bool, trace_id: str | None, message: str) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT INTO pending_messages
                   (message_id, received_at, binding, mode, conversation_id,
                    contact_id, authenticated, trace_id, message)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (message_id, received_at, binding, mode, conversation_id,
                 contact_id, int(bool(authenticated)), trace_id, message),
            )

    def lease(self, *, max_items: int, lease_secs: int, leased_by: str | None) -> list[dict[str, Any]]:
        now = int(time.time())
        until = now + lease_secs
        with self._lock, self._conn() as c:
            c.execute("BEGIN IMMEDIATE")
            rows = c.execute(
                """SELECT message_id FROM pending_messages
                   WHERE status='pending' AND attempts < ? AND delivered=0
                   ORDER BY received_at ASC
                   LIMIT ?""",
                (LEASE_MAX_ATTEMPTS, max_items),
            ).fetchall()
            ids = [r["message_id"] for r in rows]
            if not ids:
                c.execute("COMMIT")
                return []
            placeholders = ",".join("?" * len(ids))
            c.execute(
                f"""UPDATE pending_messages
                    SET status='leased', leased_at=?, leased_until=?, leased_by=?,
                        attempts=attempts+1
                    WHERE message_id IN ({placeholders})""",
                (now, until, leased_by, *ids),
            )
            leased = c.execute(
                f"""SELECT message_id, received_at, conversation_id, contact_id,
                           authenticated, trace_id, message, attempts, leased_until
                    FROM pending_messages
                    WHERE message_id IN ({placeholders})""",
                ids,
            ).fetchall()
            c.execute("COMMIT")
            out = []
            for r in leased:
                out.append({
                    "message_id":      r["message_id"],
                    "received_at":     r["received_at"],
                    "conversation_id": r["conversation_id"],
                    "contact_id":      r["contact_id"],
                    "authenticated":   bool(r["authenticated"]),
                    "trace_id":        r["trace_id"],
                    "message":         r["message"],
                    "attempts":        r["attempts"],
                    "leased_until":    r["leased_until"],
                })
            return out

    def record_reply(self, *, message_id: str, reply: str,
                     finished_at: str | None, reply_trace_id: str | None) -> dict[str, Any] | None:
        """Mark a leased message done with a reply. Returns the row needed to forward, or None."""
        now = int(time.time())
        with self._conn() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                "SELECT message_id, conversation_id, trace_id, status FROM pending_messages WHERE message_id=?",
                (message_id,),
            ).fetchone()
            if row is None:
                c.execute("ROLLBACK")
                return None
            if row["status"] not in ("leased", "pending"):
                c.execute("ROLLBACK")
                return {"already": row["status"]}
            c.execute(
                """UPDATE pending_messages
                   SET status='done', done_at=?, reply_text=?, reply_finished_at=?,
                       reply_trace_id=?, reply_next_attempt_at=?
                   WHERE message_id=?""",
                (now, reply, finished_at, reply_trace_id, now, message_id),
            )
            c.execute("COMMIT")
            return {
                "message_id":      row["message_id"],
                "conversation_id": row["conversation_id"],
                "inbound_trace_id": row["trace_id"],
            }

    def ack_no_reply(self, message_id: str) -> bool:
        now = int(time.time())
        with self._conn() as c:
            cur = c.execute(
                """UPDATE pending_messages
                   SET status='done', done_at=?, reply_forwarded=1, reply_status='no_reply'
                   WHERE message_id=? AND status IN ('leased','pending')""",
                (now, message_id),
            )
            return cur.rowcount > 0

    def release(self, message_id: str) -> bool:
        with self._conn() as c:
            cur = c.execute(
                """UPDATE pending_messages
                   SET status='pending', leased_at=NULL, leased_until=NULL, leased_by=NULL
                   WHERE message_id=? AND status='leased'""",
                (message_id,),
            )
            return cur.rowcount > 0

    def expire_leases(self) -> int:
        now = int(time.time())
        with self._conn() as c:
            cur = c.execute(
                """UPDATE pending_messages
                   SET status='pending', leased_at=NULL, leased_until=NULL, leased_by=NULL
                   WHERE status='leased' AND leased_until < ?""",
                (now,),
            )
            n_returned = cur.rowcount
            cur = c.execute(
                """UPDATE pending_messages
                   SET status='abandoned'
                   WHERE status='pending' AND attempts >= ?""",
                (LEASE_MAX_ATTEMPTS,),
            )
            n_abandoned = cur.rowcount
            return n_returned + n_abandoned

    def claim_forward_batch(self, limit: int) -> list[dict[str, Any]]:
        now = int(time.time())
        with self._conn() as c:
            rows = c.execute(
                """SELECT message_id, conversation_id, reply_text, reply_finished_at,
                          reply_trace_id, trace_id, reply_attempts
                   FROM pending_messages
                   WHERE status='done'
                     AND reply_forwarded=0
                     AND reply_attempts < ?
                     AND (reply_next_attempt_at IS NULL OR reply_next_attempt_at <= ?)
                     AND (reply_status IS NULL OR reply_status NOT IN ('auth_error','rejected'))
                   ORDER BY done_at ASC
                   LIMIT ?""",
                (REPLY_RETRY_MAX_ATTEMPTS, now, limit),
            ).fetchall()
            return [
                {
                    "message_id":         r["message_id"],
                    "conversation_id":    r["conversation_id"],
                    "reply":              r["reply_text"],
                    "finished_at":        r["reply_finished_at"],
                    "trace_id":           r["reply_trace_id"] or r["trace_id"],
                    "reply_attempts":     r["reply_attempts"],
                }
                for r in rows
            ]

    def mark_forwarded(self, message_id: str) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE pending_messages SET reply_forwarded=1, reply_status='forwarded', reply_last_error=NULL WHERE message_id=?",
                (message_id,),
            )

    def record_forward_failure(self, *, message_id: str, status: str, error: str,
                               retryable: bool) -> None:
        with self._conn() as c:
            row = c.execute(
                "SELECT reply_attempts FROM pending_messages WHERE message_id=?",
                (message_id,),
            ).fetchone()
            attempts = (row["reply_attempts"] if row else 0) + 1
            next_at = None
            if retryable and attempts < REPLY_RETRY_MAX_ATTEMPTS:
                backoff = RETRY_BACKOFF_SECS[min(attempts - 1, len(RETRY_BACKOFF_SECS) - 1)]
                next_at = int(time.time()) + backoff
            c.execute(
                """UPDATE pending_messages
                   SET reply_attempts=?, reply_status=?, reply_last_error=?, reply_next_attempt_at=?
                   WHERE message_id=?""",
                (attempts, status, error[:500], next_at, message_id),
            )

    def claim_push_batch(self, limit: int) -> list[dict[str, Any]]:
        """Pick rows ready to be pushed to Danny. Atomic under self._lock."""
        now = int(time.time())
        with self._lock, self._conn() as c:
            c.execute("BEGIN IMMEDIATE")
            rows = c.execute(
                """SELECT message_id, received_at, conversation_id, contact_id,
                          authenticated, trace_id, message, delivery_attempts
                   FROM pending_messages
                   WHERE status='pending'
                     AND delivered=0
                     AND delivery_attempts < ?
                     AND (delivery_next_attempt_at IS NULL OR delivery_next_attempt_at <= ?)
                     AND (delivery_status IS NULL OR delivery_status NOT IN ('auth_error','rejected'))
                   ORDER BY received_at ASC
                   LIMIT ?""",
                (PUSH_RETRY_MAX_ATTEMPTS, now, limit),
            ).fetchall()
            ids = [r["message_id"] for r in rows]
            if not ids:
                c.execute("COMMIT")
                return []
            placeholders = ",".join("?" * len(ids))
            c.execute(
                f"""UPDATE pending_messages
                    SET delivery_next_attempt_at=?,
                        delivery_attempts=delivery_attempts+1
                    WHERE message_id IN ({placeholders})""",
                (now + PUSH_TIMEOUT_SECS + 1, *ids),
            )
            c.execute("COMMIT")
            return [
                {
                    "message_id":      r["message_id"],
                    "received_at":     r["received_at"],
                    "conversation_id": r["conversation_id"],
                    "contact_id":      r["contact_id"],
                    "authenticated":   bool(r["authenticated"]),
                    "trace_id":        r["trace_id"],
                    "message":         r["message"],
                    "attempts":        r["delivery_attempts"] + 1,
                }
                for r in rows
            ]

    def mark_pushed(self, message_id: str) -> None:
        now = int(time.time())
        with self._conn() as c:
            c.execute(
                """UPDATE pending_messages
                   SET delivered=1, delivered_at=?, delivery_status='delivered',
                       delivery_last_error=NULL, delivery_next_attempt_at=NULL
                   WHERE message_id=?""",
                (now, message_id),
            )

    def record_push_failure(self, *, message_id: str, status: str, error: str,
                            retryable: bool) -> None:
        with self._conn() as c:
            row = c.execute(
                "SELECT delivery_attempts FROM pending_messages WHERE message_id=?",
                (message_id,),
            ).fetchone()
            attempts = (row["delivery_attempts"] if row else 0)
            next_at = None
            if retryable and attempts < PUSH_RETRY_MAX_ATTEMPTS:
                backoff = RETRY_BACKOFF_SECS[min(attempts - 1, len(RETRY_BACKOFF_SECS) - 1)] if attempts >= 1 else RETRY_BACKOFF_SECS[0]
                next_at = int(time.time()) + backoff
            c.execute(
                """UPDATE pending_messages
                   SET delivery_status=?, delivery_last_error=?, delivery_next_attempt_at=?
                   WHERE message_id=?""",
                (status, error[:500], next_at, message_id),
            )

    def stats(self) -> dict[str, Any]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT status, COUNT(*) AS n FROM pending_messages GROUP BY status"
            ).fetchall()
            counts = {r["status"]: r["n"] for r in rows}
            forward_pending = c.execute(
                "SELECT COUNT(*) AS n FROM pending_messages WHERE status='done' AND reply_forwarded=0 AND (reply_status IS NULL OR reply_status NOT IN ('auth_error','rejected','no_reply'))"
            ).fetchone()["n"]
            forward_auth_errors = c.execute(
                "SELECT COUNT(*) AS n FROM pending_messages WHERE reply_status='auth_error'"
            ).fetchone()["n"]
            push_pending = c.execute(
                "SELECT COUNT(*) AS n FROM pending_messages WHERE status='pending' AND delivered=0 AND (delivery_status IS NULL OR delivery_status NOT IN ('auth_error','rejected'))"
            ).fetchone()["n"]
            push_auth_errors = c.execute(
                "SELECT COUNT(*) AS n FROM pending_messages WHERE delivery_status='auth_error'"
            ).fetchone()["n"]
            return {
                "by_status":             counts,
                "forward_pending":       forward_pending,
                "forward_auth_errors":   forward_auth_errors,
                "backend_token_present": bool(BACKEND_REPLY_TOKEN),
                "push_pending":          push_pending,
                "push_auth_errors":      push_auth_errors,
                "push_token_present":    bool(PUSH_TOKEN),
                "push_url":              PUSH_URL,
            }


queue = Queue(QUEUE_DB)


# ─── Forwarder ─────────────────────────────────────────────────────────────
def _post_json(url: str, payload: dict[str, Any], token: str, timeout: int
               ) -> tuple[int, str]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, (resp.read(512).decode("utf-8", "replace") or "")
    except urllib.error.HTTPError as e:
        return e.code, (e.read(512).decode("utf-8", "replace") if hasattr(e, "read") else str(e))
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, f"network:{e}"


def forwarder_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            if not BACKEND_REPLY_TOKEN:
                stop.wait(FORWARDER_INTERVAL)
                continue
            batch = queue.claim_forward_batch(limit=10)
            for item in batch:
                payload = {
                    "conversation_id": item["conversation_id"],
                    "message_id":      item["message_id"],
                    "reply":           item["reply"],
                }
                if item["trace_id"]:
                    payload["trace_id"] = item["trace_id"]
                if item["finished_at"]:
                    payload["finished_at"] = item["finished_at"]
                status, body = _post_json(BACKEND_REPLY_URL, payload, BACKEND_REPLY_TOKEN, REPLY_TIMEOUT_SECS)
                if 200 <= status < 300:
                    queue.mark_forwarded(item["message_id"])
                    logger.info("forwarded reply mid=%s conv=%s status=%d", item["message_id"], item["conversation_id"], status)
                elif status == 401:
                    logger.error("forward AUTH error mid=%s status=%d body=%s", item["message_id"], status, body[:200])
                    queue.record_forward_failure(message_id=item["message_id"], status="auth_error", error=body, retryable=False)
                elif 400 <= status < 500:
                    logger.error("forward REJECTED mid=%s status=%d body=%s", item["message_id"], status, body[:200])
                    queue.record_forward_failure(message_id=item["message_id"], status="rejected", error=body, retryable=False)
                else:
                    logger.warning("forward retryable failure mid=%s status=%d body=%s", item["message_id"], status, body[:200])
                    queue.record_forward_failure(message_id=item["message_id"], status="retryable", error=body or f"http:{status}", retryable=True)
        except Exception:
            logger.exception("forwarder iteration failed")
        stop.wait(FORWARDER_INTERVAL)


def pusher_loop(stop: threading.Event) -> None:
    """Push newly-arrived inbounds to Danny's plugin endpoint."""
    while not stop.is_set():
        try:
            if not PUSH_TOKEN:
                stop.wait(PUSHER_INTERVAL)
                continue
            batch = queue.claim_push_batch(limit=5)
            for item in batch:
                payload = {
                    "message_id":      item["message_id"],
                    "conversation_id": item["conversation_id"],
                    "contact_id":      item["contact_id"],
                    "authenticated":   item["authenticated"],
                    "trace_id":        item["trace_id"],
                    "message":         item["message"],
                    "received_at":     item["received_at"],
                    "attempts":        item["attempts"],
                }
                status, body = _post_json(PUSH_URL, payload, PUSH_TOKEN, PUSH_TIMEOUT_SECS)
                if 200 <= status < 300:
                    queue.mark_pushed(item["message_id"])
                    logger.info("pushed inbound mid=%s conv=%s status=%d", item["message_id"], item["conversation_id"], status)
                elif status == 401:
                    logger.error("push AUTH error mid=%s status=%d body=%s", item["message_id"], status, body[:200])
                    queue.record_push_failure(message_id=item["message_id"], status="auth_error", error=body, retryable=False)
                elif 400 <= status < 500:
                    logger.error("push REJECTED mid=%s status=%d body=%s", item["message_id"], status, body[:200])
                    queue.record_push_failure(message_id=item["message_id"], status="rejected", error=body, retryable=False)
                else:
                    logger.warning("push retryable failure mid=%s status=%d body=%s", item["message_id"], status, body[:200])
                    queue.record_push_failure(message_id=item["message_id"], status="retryable", error=body or f"http:{status}", retryable=True)
        except Exception:
            logger.exception("pusher iteration failed")
        stop.wait(PUSHER_INTERVAL)


def lease_expirer_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            n = queue.expire_leases()
            if n:
                logger.info("lease expirer touched %d rows", n)
        except Exception:
            logger.exception("lease expirer iteration failed")
        stop.wait(LEASE_EXPIRER_INTERVAL)


# ─── HTTP helpers ──────────────────────────────────────────────────────────
def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _bearer(handler: BaseHTTPRequestHandler) -> str | None:
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return header[len("Bearer "):].strip()


def _check(handler: BaseHTTPRequestHandler, expected: str) -> bool:
    if not expected:
        logger.error("expected token is empty; rejecting")
        return False
    presented = _bearer(handler)
    return bool(presented) and hmac.compare_digest(presented, expected)


def _read_json_body(handler: BaseHTTPRequestHandler) -> Any:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        return None
    if length <= 0 or length > MAX_BODY_BYTES:
        return None
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


# ─── Handler ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "DannyWidgetBridge/0.3"

    def log_message(self, fmt: str, *args: Any) -> None:
        logger.info("%s - %s", self.client_address[0], fmt % args)

    # GET routes
    def do_GET(self) -> None:
        if self.path == "/healthz":
            _json_response(self, 200, {"status": "ok", "service": "danny-widget-bridge", "queue": queue.stats()})
            return
        if self.path.startswith("/pending"):
            self._handle_pending()
            return
        _json_response(self, 404, {"error": "not_found"})

    # POST routes
    def do_POST(self) -> None:
        if self.path == "/inbound/danny-widget":
            self._handle_inbound()
            return
        if self.path.startswith("/reply/"):
            self._handle_reply(self.path[len("/reply/"):])
            return
        if self.path.startswith("/ack/"):
            self._handle_ack(self.path[len("/ack/"):])
            return
        if self.path.startswith("/release/"):
            self._handle_release(self.path[len("/release/"):])
            return
        _json_response(self, 404, {"error": "not_found"})

    # ─── /inbound/danny-widget (backend → bridge) ───
    def _handle_inbound(self) -> None:
        if not _check(self, AUTH_TOKEN):
            _json_response(self, 401, {"error": "unauthorized"})
            return
        payload = _read_json_body(self)
        if payload is None or not isinstance(payload, dict):
            _json_response(self, 400, {"error": "invalid_json_or_too_large"})
            return
        missing = [f for f in REQUIRED_INBOUND_FIELDS if f not in payload]
        if missing:
            _json_response(self, 422, {"error": "missing_fields", "fields": missing})
            return
        if payload.get("binding") != EXPECTED_BINDING:
            _json_response(self, 422, {"error": "unexpected_binding", "expected": EXPECTED_BINDING})
            return
        if payload.get("mode") != "buyer":
            _json_response(self, 422, {"error": "unexpected_mode", "expected": "buyer"})
            return
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            _json_response(self, 422, {"error": "empty_message"})
            return

        message_id = secrets.token_hex(8)
        received_at = int(time.time())
        try:
            queue.insert_inbound(
                message_id=message_id,
                received_at=received_at,
                binding=payload["binding"],
                mode=payload["mode"],
                conversation_id=str(payload["conversation_id"]),
                contact_id=payload.get("contact_id"),
                authenticated=bool(payload.get("authenticated", False)),
                trace_id=payload.get("trace_id"),
                message=message,
            )
        except sqlite3.Error:
            logger.exception("queue insert failed")
            _json_response(self, 500, {"error": "queue_unavailable"})
            return

        record = {
            "message_id":      message_id,
            "received_at":     received_at,
            "binding":         payload["binding"],
            "mode":            payload["mode"],
            "conversation_id": payload["conversation_id"],
            "contact_id":      payload.get("contact_id"),
            "authenticated":   bool(payload.get("authenticated", False)),
            "trace_id":        payload.get("trace_id"),
            "message_len":     len(message),
            "remote_addr":     self.client_address[0],
        }
        with contextlib.suppress(Exception):
            _audit_logger.info(json.dumps(record, separators=(",", ":")))

        _json_response(self, 202, {
            "status":      "accepted",
            "message_id":  message_id,
            "trace_id":    payload.get("trace_id"),
            "reply_model": "async",
        })

    # ─── GET /pending  (Danny polls) ───
    def _handle_pending(self) -> None:
        if not _check(self, POLL_TOKEN):
            _json_response(self, 401, {"error": "unauthorized"})
            return
        # parse query
        max_items = 10
        lease_secs = LEASE_SECS_DEFAULT
        leased_by = None
        if "?" in self.path:
            _, qs = self.path.split("?", 1)
            for kv in qs.split("&"):
                if "=" not in kv:
                    continue
                k, v = kv.split("=", 1)
                if k == "max":
                    with contextlib.suppress(ValueError):
                        max_items = max(1, min(50, int(v)))
                elif k == "lease_secs":
                    with contextlib.suppress(ValueError):
                        lease_secs = max(5, min(600, int(v)))
                elif k == "by":
                    leased_by = v[:64]
        try:
            items = queue.lease(max_items=max_items, lease_secs=lease_secs, leased_by=leased_by)
        except sqlite3.Error:
            logger.exception("lease failed")
            _json_response(self, 500, {"error": "queue_unavailable"})
            return
        _json_response(self, 200, {"items": items, "lease_secs": lease_secs})

    # ─── POST /reply/<id>  (Danny posts reply) ───
    def _handle_reply(self, mid: str) -> None:
        if not _check(self, POLL_TOKEN):
            _json_response(self, 401, {"error": "unauthorized"})
            return
        if not mid or "/" in mid:
            _json_response(self, 400, {"error": "bad_message_id"})
            return
        payload = _read_json_body(self)
        if payload is None or not isinstance(payload, dict):
            _json_response(self, 400, {"error": "invalid_json_or_too_large"})
            return
        reply = payload.get("reply")
        if not isinstance(reply, str) or not reply.strip():
            _json_response(self, 422, {"error": "empty_reply"})
            return
        finished_at = payload.get("finished_at")
        reply_trace_id = payload.get("trace_id")
        try:
            result = queue.record_reply(
                message_id=mid,
                reply=reply,
                finished_at=finished_at if isinstance(finished_at, str) else None,
                reply_trace_id=reply_trace_id if isinstance(reply_trace_id, str) else None,
            )
        except sqlite3.Error:
            logger.exception("record_reply failed")
            _json_response(self, 500, {"error": "queue_unavailable"})
            return
        if result is None:
            _json_response(self, 404, {"error": "unknown_message_id"})
            return
        if "already" in result:
            _json_response(self, 409, {"error": "already_completed", "status": result["already"]})
            return
        _json_response(self, 202, {"status": "accepted_for_forward", "message_id": mid})

    # ─── POST /ack/<id>  (Danny: no reply, done) ───
    def _handle_ack(self, mid: str) -> None:
        if not _check(self, POLL_TOKEN):
            _json_response(self, 401, {"error": "unauthorized"})
            return
        if not mid or "/" in mid:
            _json_response(self, 400, {"error": "bad_message_id"})
            return
        ok = queue.ack_no_reply(mid)
        if not ok:
            _json_response(self, 404, {"error": "unknown_or_not_leased"})
            return
        _json_response(self, 200, {"status": "acked", "message_id": mid})

    # ─── POST /release/<id>  (Danny: release lease early) ───
    def _handle_release(self, mid: str) -> None:
        if not _check(self, POLL_TOKEN):
            _json_response(self, 401, {"error": "unauthorized"})
            return
        if not mid or "/" in mid:
            _json_response(self, 400, {"error": "bad_message_id"})
            return
        ok = queue.release(mid)
        if not ok:
            _json_response(self, 404, {"error": "unknown_or_not_leased"})
            return
        _json_response(self, 200, {"status": "released", "message_id": mid})


# ─── main ──────────────────────────────────────────────────────────────────
def main() -> int:
    if not AUTH_TOKEN:
        logger.error("BRIDGE_AUTH_TOKEN is not set; aborting")
        return 2
    if not POLL_TOKEN:
        logger.error("BRIDGE_POLL_TOKEN is not set; aborting")
        return 2
    if not BACKEND_REPLY_TOKEN:
        logger.warning("BRIDGE_BACKEND_REPLY_TOKEN is empty — replies will queue but not forward")
    if not PUSH_TOKEN:
        logger.warning("BRIDGE_PUSH_TOKEN is empty — inbounds will queue but not push to Danny")
    server = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    logger.info("danny-widget-bridge v0.3 listening on %s:%d (queue=%s, push_url=%s)",
                BIND_HOST, BIND_PORT, QUEUE_DB, PUSH_URL)

    stop = threading.Event()
    t_fwd  = threading.Thread(target=forwarder_loop,     args=(stop,), name="forwarder",     daemon=True)
    t_exp  = threading.Thread(target=lease_expirer_loop, args=(stop,), name="lease-expirer", daemon=True)
    t_push = threading.Thread(target=pusher_loop,        args=(stop,), name="pusher",        daemon=True)
    t_fwd.start()
    t_exp.start()
    t_push.start()

    def _shutdown(_signo: int, _frame: Any) -> None:
        logger.info("shutdown signal received")
        stop.set()
        server.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
