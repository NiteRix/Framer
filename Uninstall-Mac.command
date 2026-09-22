#!/usr/bin/env bash
#
# Removes the Framer panel from Premiere's user extension folder.
# The CEP "unsigned extensions allowed" setting is left alone on purpose:
# other unsigned panels may rely on it.

set -uo pipefail

EXT_ID="com.niterix.framer"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

echo
echo "  Removing Framer..."
echo "    $DEST"
echo

if [ ! -d "$DEST" ]; then
  echo "  [--] Nothing to remove - Framer is not installed there."
else
  if rm -rf "$DEST"; then
    echo "  [ok] Removed."
  else
    echo "  [X] Could not remove it. Close Premiere Pro and try again."
    read -r -n 1 -p "  Press any key to close."
    exit 1
  fi
fi

echo
echo "  Restart Premiere Pro to clear the panel from the Extensions menu."
echo
read -r -n 1 -p "  Press any key to close."
exit 0
