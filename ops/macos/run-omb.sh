#!/usr/bin/env bash
# OpenMausBot harness, unmodified, on loopback port 8899 with its own data folder.
source "$(dirname "$0")/common.sh"
export PATH="$(node_for 24):$PATH"
exec "$OMB_HOME/cli/node_modules/.bin/openmausbot" serve \
  --port 8899 --data-dir "$OMB_HOME/data" --label nonna --no-pair
