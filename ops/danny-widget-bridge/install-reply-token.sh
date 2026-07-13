#!/usr/bin/env bash
# install-reply-token.sh — one-shot installer for backend's DANNY_REPLY_TOKEN.
# Operator usage:
#   1. scp /root/danny_reply_token.secret from backend-vps → MC's /root/
#   2. /opt/danny-widget-bridge/install-reply-token.sh
#      (or pass an explicit path:
#       /opt/danny-widget-bridge/install-reply-token.sh /root/danny_reply_token.secret)
#
# Reads the token, pastes into BRIDGE_BACKEND_REPLY_TOKEN in /etc/danny-widget-bridge.env,
# restarts the bridge, and confirms healthz reports backend_token_present: true.
# Idempotent + safe to re-run; never prints the token.
set -euo pipefail

SRC="${1:-/root/danny_reply_token.secret}"
ENV="/etc/danny-widget-bridge.env"
HEALTH_URL="http://10.50.0.1:8089/healthz"

if [[ ! -r "$SRC" ]]; then
  echo "ERR: token source not readable: $SRC" >&2
  exit 1
fi
TOK="$(tr -d '[:space:]' < "$SRC")"
if [[ -z "$TOK" ]]; then
  echo "ERR: token file is empty: $SRC" >&2
  exit 1
fi
# Accept env-form ("KEY=value", optionally quoted) or bare token; strip prefix + quotes.
if [[ "$TOK" == *"="* ]]; then
  TOK="${TOK#*=}"
fi
TOK="${TOK#\"}"; TOK="${TOK%\"}"
TOK="${TOK#\'}"; TOK="${TOK%\'}"
if [[ ${#TOK} -lt 32 ]]; then
  echo "ERR: token looks too short (${#TOK} chars) after parsing; refusing to install" >&2
  exit 1
fi

# Sanity: env file must be writable + readable
[[ -r "$ENV" && -w "$ENV" ]] || { echo "ERR: $ENV not r/w"; exit 1; }

# Atomic in-place edit (preserve mode 0600)
TMP="$(mktemp)"
chmod 0600 "$TMP"
awk -v t="$TOK" '
  BEGIN { done = 0 }
  /^BRIDGE_BACKEND_REPLY_TOKEN=/ { print "BRIDGE_BACKEND_REPLY_TOKEN=" t; done = 1; next }
  { print }
  END {
    if (!done) { print "BRIDGE_BACKEND_REPLY_TOKEN=" t }
  }
' "$ENV" > "$TMP"

# Preserve owner/mode of original
chown --reference="$ENV" "$TMP"
chmod --reference="$ENV" "$TMP"
mv "$TMP" "$ENV"

systemctl restart danny-widget-bridge.service
sleep 1

if ! systemctl is-active --quiet danny-widget-bridge.service; then
  echo "ERR: bridge failed to come up after restart; check 'journalctl -u danny-widget-bridge -n 30'" >&2
  exit 2
fi

# Confirm token present from the service's own view
PRESENT="$(curl -fsS "$HEALTH_URL" | python3 -c "import sys,json; print(json.load(sys.stdin)['queue']['backend_token_present'])")"
if [[ "$PRESENT" == "True" ]]; then
  echo "OK  bridge restarted; backend_token_present=true"
else
  echo "ERR healthz reports backend_token_present=$PRESENT — env may not have been picked up" >&2
  exit 3
fi
