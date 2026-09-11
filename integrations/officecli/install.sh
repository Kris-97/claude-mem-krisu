#!/usr/bin/env bash
# Thin launcher for the claude-mem <-> OfficeCLI bridge installer.
# All logic lives in scripts/install.mjs so this and install.ps1 cannot drift.
#
#   ./install.sh --target /path/to/OfficeCLI [--project officecli]
#
# With no --target, the current directory is the target project.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# nvm-managed node is not on a login-shell PATH in every context claude-mem
# hooks run in; claude-mem's own hooks prepend the same locations.
if ! command -v node >/dev/null 2>&1; then
  if [ -d "$HOME/.nvm/versions/node" ]; then
    latest="$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
    [ -n "$latest" ] && PATH="$HOME/.nvm/versions/node/v$latest/bin:$PATH"
  fi
  PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
  export PATH
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found on PATH. claude-mem requires Node >= 20.12; install it and re-run." >&2
  exit 1
fi

exec node "$HERE/scripts/install.mjs" "$@"
