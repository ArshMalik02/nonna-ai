#!/usr/bin/env bash
# Nonna gateway. caffeinate keeps the Mac from idle-sleeping while it runs on power.
source "$(dirname "$0")/common.sh"
cd "$GATEWAY"
[[ -f dist/index.js ]] || pnpm --dir "$REPO" build
exec caffeinate -is node --env-file="$REPO/.env" dist/index.js
