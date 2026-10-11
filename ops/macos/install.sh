#!/usr/bin/env bash
# Installs Nonna as three login services (launchd user agents): OpenMausBot, the gateway and the
# tunnel. They start at login, restart if they crash, and keep running when no terminal is open.
# Remove with ./uninstall.sh. Logs: apps/gateway/data/logs/.
source "$(dirname "$0")/common.sh"
AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS"
chmod +x "$REPO"/ops/macos/run-*.sh

plist() { # label script
  local label="$1" script="$2"
  cat >"$AGENTS/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO/ops/macos/$script</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  echo "installed $label"
}

plist ai.nonna.omb run-omb.sh
plist ai.nonna.gateway run-gateway.sh
plist ai.nonna.tunnel run-tunnel.sh
echo "Nonna is running. Status: launchctl list | grep ai.nonna"
