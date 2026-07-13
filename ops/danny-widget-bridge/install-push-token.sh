#!/usr/bin/env bash
# install-push-token.sh — one-shot installer for Danny-generated BRIDGE_PUSH_TOKEN.
# Operator usage:
#   1. Danny generates BRIDGE_PUSH_TOKEN on danny-vps, stages mode 0600.
#   2. scp from danny-vps → MC's /root/bridge_push_token.secret
#   3. /opt/danny-widget-bridge/install-push-token.sh
#      (or pass an explicit path)
#
# Mirrors install-reply-token.sh; pastes into BRIDGE_PUSH_TOKEN in the env file,
# restarts, verifies healthz reports push_token_present: true.
set -euo pipefail

SRC="${1:-/root/bridge_push_token.secret}"
ENV="/etc/danny-widget-bridge.env"
HEALTH_URL="http://10.50.0.1:8089/healthz"

[[ -r "$SRC" ]] || { echo "ERR: token source not readable: $SRC" >&2; exit 1; }
TOK="$(tr -d '[:space:]' < "$SRC")"
[[ -n "$TOK" ]] || { echo "ERR: token file is empty: $SRC" >&2; exit 1; }
# Accept env-form ("KEY=value", optionally quoted) or bare token; strip prefix + quotes.
if [[ "$TOK" == *"="* ]]; then TOK="${TOK#*=}"; fi
TOK="${TOK#\"}"; TOK="${TOK%\"}"
TOK="${TOK#\'}"; TOK="${TOK%\'}"
[[ ${#TOK} -ge 32 ]] || { echo "ERR: token looks too short (${#TOK} chars) after parsing; refusing" >&2; exit 1; }
[[ -r "$ENV" && -w "$ENV" ]] || { echo "ERR: $ENV not r/w"; exit 1; }

TMP="$(mktemp)"; chmod 0600 "$TMP"
awk -v t="$TOK" '
  BEGIN { done = 0 }
  /^BRIDGE_PUSH_TOKEN=/ { print "BRIDGE_PUSH_TOKEN=" t; done = 1; next }
  { print }
  END { if (!done) print "BRIDGE_PUSH_TOKEN=" t }
' "$ENV" > "$TMP"
chown --reference="$ENV" "$TMP"
chmod --reference="$ENV" "$TMP"
mv "$TMP" "$ENV"

systemctl restart danny-widget-bridge.service
sleep 1
systemctl is-active --quiet danny-widget-bridge.service || {
  echo "ERR: bridge failed to come up after restart; check 'journalctl -u danny-widget-bridge -n 30'" >&2
  exit 2
}

HEALTH_JSON="$(curl -fsS "$HEALTH_URL")"
PRESENT="$(printf '%s' "$HEALTH_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['queue']['push_token_present'])")"
PUSH_URL="$(printf '%s' "$HEALTH_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['queue']['push_url'])")"
if [[ "$PRESENT" == "True" ]]; then
  echo "OK  bridge restarted; push_token_present=true (will start pushing to $PUSH_URL)"
else
  echo "ERR healthz reports push_token_present=$PRESENT — env may not have been picked up" >&2
  exit 3
fi
