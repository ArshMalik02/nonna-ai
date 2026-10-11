# Shared settings for Nonna's macOS services. Sourced by the run-*.sh scripts.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY="$REPO/apps/gateway"
LOGS="$GATEWAY/data/logs"
OMB_HOME="${OMB_HOME:-$HOME/.openmausbot-nonna}"
mkdir -p "$LOGS"

# Node versions from nvm: the gateway uses Node 22+, OpenMausBot needs Node 24+.
node_for() {
  local major="$1" dir
  dir="$(ls -d "$HOME"/.nvm/versions/node/v"$major".* 2>/dev/null | sort -V | tail -1)"
  [[ -n "$dir" ]] || { echo "Node $major not found under ~/.nvm (nvm install $major)" >&2; exit 1; }
  echo "$dir/bin"
}
export PATH="$(node_for 22):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
