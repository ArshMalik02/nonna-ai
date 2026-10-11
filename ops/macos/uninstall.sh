#!/usr/bin/env bash
# Stops and removes Nonna's login services.
set -euo pipefail
for label in ai.nonna.tunnel ai.nonna.gateway ai.nonna.omb; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
  echo "removed $label"
done
