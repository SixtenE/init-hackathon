#!/bin/sh
# Caddy owns $PORT. The C++ relay stays on an internal port so they don't collide.
set -e

/usr/local/bin/game_server 8090 &
SERVER_PID=$!

sleep 0.2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[start] game_server failed to start" >&2
  exit 1
fi

trap 'kill "$SERVER_PID" 2>/dev/null || true' INT TERM
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
