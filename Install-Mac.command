#!/usr/bin/env bash
#
# Framer installer for macOS.
# Copies the panel into Premiere's user extension folder and tells CEP that
# unsigned extensions are allowed to load. Everything lives under the current
# user's Library, so no admin rights are needed.
#
#   --silent   no prompts, no keypress at the end

set -uo pipefail

EXT_ID="com.niterix.framer"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SILENT=0
for arg in "$@"; do
  [ "$arg" = "--silent" ] && SILENT=1
done

echo
echo "  ==========================================="
echo "    Framer for Premiere Pro"
echo "  ==========================================="
echo

# --- locate the payload ------------------------------------------------------
SRC=""
for candidate in "$HERE/extension" "$HERE/../../extension" "$HERE/../extension"; do
  if [ -f "$candidate/CSXS/manifest.xml" ]; then
    SRC="$(cd "$candidate" && pwd)"
    break
  fi
done

if [ -z "$SRC" ]; then
  echo "  [X] Could not find the \"extension\" folder next to this installer."
  echo "      Keep Install-Mac.command in the same folder as \"extension\"."
  [ "$SILENT" = "0" ] && read -r -n 1 -p "  Press any key to close."
  exit 1
fi

# --- is Premiere running? ----------------------------------------------------
if pgrep -x "Adobe Premiere Pro" >/dev/null 2>&1; then
  echo "  [!] Premiere Pro is open. The panel will only appear after you restart it."
  echo
fi

# --- copy --------------------------------------------------------------------
echo "  Installing to:"
echo "    $DEST"
echo

rm -rf "$DEST"
mkdir -p "$DEST"
if ! cp -R "$SRC/." "$DEST/"; then
  echo "  [X] Copy failed. Close Premiere Pro and run this again."
  [ "$SILENT" = "0" ] && read -r -n 1 -p "  Press any key to close."
  exit 1
fi
echo "  [ok] Panel files copied."

# --- allow unsigned extensions ----------------------------------------------
for version in 6 7 8 9 10 11 12; do
  defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null || true
done
# Premiere reads these at launch, so the cached copy has to go.
killall cfprefsd 2>/dev/null || true
echo "  [ok] Unsigned extensions enabled for CEP 6-12."

echo
echo "  ==========================================="
echo "    Done."
echo
echo "    Restart Premiere Pro, then open:"
echo "      Window  >  Extensions  >  Framer"
echo
echo "    One setting matters: in Premiere,"
echo "      Premiere Pro > Settings > Media > Default Media Scaling"
echo "    must be set to \"None\", or Premiere rescales the"
echo "    clips Framer places and the layers will not line up."
echo "  ==========================================="
echo
[ "$SILENT" = "0" ] && read -r -n 1 -p "  Press any key to close."
exit 0
