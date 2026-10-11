#!/usr/bin/env bash
# Cloudflare quick tunnel to the gateway. Each start gets a new public address, so once it's up
# this re-points Dial at it (webhook + live-call MCP) and restarts the gateway for the new secret.
source "$(dirname "$0")/common.sh"
TUNNEL_LOG="$LOGS/cloudflared.log"
: > "$TUNNEL_LOG"
cloudflared tunnel --no-autoupdate --url http://localhost:8787 >>"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT TERM INT

url=""
for _ in $(seq 1 60); do
  url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
  [[ -n "$url" ]] && break
  sleep 2
done
[[ -n "$url" ]] || { echo "tunnel did not come up" >&2; exit 1; }
echo "tunnel: $url"

# Wait for the gateway, then connect Dial and reload the gateway's secrets.
for _ in $(seq 1 60); do curl -fsS http://localhost:8787/health >/dev/null 2>&1 && break; sleep 2; done
for attempt in 1 2 3; do
  if (cd "$REPO" && pnpm dial:connect "$url"); then break; fi
  echo "dial:connect failed (attempt $attempt), retrying" >&2
  sleep 10
done
launchctl kickstart -k "gui/$(id -u)/ai.nonna.gateway" || true
# Context MCP registration needs the gateway up with the token; run once more after the restart.
for _ in $(seq 1 30); do curl -fsS http://localhost:8787/health >/dev/null 2>&1 && break; sleep 2; done
(cd "$REPO" && pnpm dial:connect "$url") || true

wait "$TUNNEL_PID"
