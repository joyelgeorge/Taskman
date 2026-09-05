#!/bin/bash
set -euo pipefail
REPO="${1:-}"
if [ -z "$REPO" ]; then
  if [ -f "$(dirname "$0")/../package.json" ]; then
    REPO="$(cd "$(dirname "$0")/.." && pwd)"
  elif [ -f "$HOME/Documents/anti-grav/taskmen/package.json" ]; then
    REPO="$HOME/Documents/anti-grav/taskmen"
  else
    echo "Pass the Taskman repo path."
    exit 1
  fi
fi
DEST="$HOME/Desktop/Taskman.command"
cp "$REPO/scripts/Taskman.command" "$DEST"
chmod +x "$DEST"
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true
echo "Clickable file: $DEST"
