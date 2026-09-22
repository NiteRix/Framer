#!/usr/bin/env bash
#
# Install Framer into Premiere Pro on macOS (and Linux, for panel development).
#
#   tools/install.sh            symlink this checkout into the CEP folder
#   tools/install.sh --copy     copy the files instead of symlinking
#   tools/install.sh --uninstall
#
# An unsigned extension only loads when CEP debug mode is on, which this turns
# on for every CEP version Premiere has shipped since CC 2019.

set -euo pipefail

BUNDLE_ID="com.niterix.framer"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$(uname -s)" in
  Darwin) EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions" ;;
  *)      EXT_DIR="$HOME/.local/share/Adobe/CEP/extensions" ;;
esac

TARGET="$EXT_DIR/$BUNDLE_ID"

enable_debug_mode() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "  (debug mode flag is macOS/Windows only - skipped)"
    return
  fi
  for version in 9 10 11 12; do
    defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null || true
  done
  # Premiere reads these at launch, so the cached copy has to go.
  killall cfprefsd 2>/dev/null || true
  echo "  CEP debug mode enabled (CSXS 9-12)"
}

uninstall() {
  if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    rm -rf "$TARGET"
    echo "Removed $TARGET"
  else
    echo "Nothing installed at $TARGET"
  fi
}

install() {
  mkdir -p "$EXT_DIR"
  rm -rf "$TARGET"

  if [ "${1:-}" = "--copy" ]; then
    mkdir -p "$TARGET"
    # Everything but the repo plumbing and the test suite.
    for item in CSXS css icons js jsx index.html .debug; do
      cp -R "$SOURCE_DIR/$item" "$TARGET/"
    done
    echo "Copied the extension to $TARGET"
  else
    ln -s "$SOURCE_DIR" "$TARGET"
    echo "Linked $TARGET -> $SOURCE_DIR"
  fi

  enable_debug_mode
  echo
  echo "Restart Premiere Pro, then open:  Window > Extensions > Framer (Vertical Reframe)"
}

case "${1:-}" in
  --uninstall) uninstall ;;
  *) install "${1:-}" ;;
esac
