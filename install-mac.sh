#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR"
PLUGIN_ROOT="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins"
TARGET="$PLUGIN_ROOT/com.stephanteig.directdownloadplus"
ORIGINAL="$PLUGIN_ROOT/com.jhaimesfilmes.directdownload"

if [[ "$TARGET" == "$ORIGINAL" ]]; then
  echo "Refusing to target the original Direct Download plugin." >&2
  exit 1
fi
if [[ ! -f "$SOURCE/manifest.xml" || ! -f "$SOURCE/main.js" ]]; then
  echo "Run this installer from the extracted DirectDownloadPlus release folder." >&2
  exit 1
fi

mkdir -p "$PLUGIN_ROOT"
if [[ -d "$ORIGINAL" ]]; then
  echo "Original Direct Download detected; it will not be modified."
fi

rsync -a --delete --exclude='.git' --exclude='test' --exclude='docs' "$SOURCE/" "$TARGET/"
echo "Installed Direct Download Plus at: $TARGET"
echo "Restart DaVinci Resolve before using the plugin."
