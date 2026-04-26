#!/usr/bin/env bash
# Fieshzen build script — builds Feishin web app, assembles WGT, signs it.
set -e

FEISHIN_SRC="${FEISHIN_SRC:-/home/will/Github/feishin}"
PROFILE="${PROFILE:-TestProfile}"
TIZEN="${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}"
OUT_WGT_NAME="Fieshzen.wgt"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d -t fieshzen-build-XXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [ ! -d "$FEISHIN_SRC" ]; then
  echo "ERROR: Feishin source not found at $FEISHIN_SRC" >&2
  exit 1
fi
if [ ! -x "$TIZEN" ]; then
  echo "ERROR: tizen CLI not found at $TIZEN" >&2
  exit 1
fi

echo "==> Installing pnpm deps"
cd "$FEISHIN_SRC"
pnpm install --frozen-lockfile

echo "==> Building Feishin web app (pnpm build:web)"
pnpm build:web

if [ ! -f "$FEISHIN_SRC/out/web/index.html" ]; then
  echo "ERROR: build did not produce out/web/index.html" >&2
  exit 1
fi

echo "==> Assembling WGT directory at $TMP_DIR"
cp -r "$FEISHIN_SRC/out/web/." "$TMP_DIR/"

# Tizen manifest
cp "$SCRIPT_DIR/tizen/config.xml" "$TMP_DIR/config.xml"

# Compatibility patches
cp "$SCRIPT_DIR/patches/tizen-compat.js" "$TMP_DIR/tizen-compat.js"
cp "$SCRIPT_DIR/patches/tizen-fixes.css" "$TMP_DIR/tizen-fixes.css"

# Inject patch tags into index.html (after the existing settings.js script)
python3 - "$TMP_DIR/index.html" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
html = p.read_text(encoding="utf-8")
needle = '<script src="settings.js"></script>'
inject = (
    '<script src="settings.js"></script>\n'
    '    <link rel="stylesheet" href="tizen-fixes.css">\n'
    '    <script src="tizen-compat.js"></script>'
)
if needle in html:
    html = html.replace(needle, inject, 1)
else:
    # fallback: inject before </head>
    html = html.replace('</head>',
        '    <link rel="stylesheet" href="tizen-fixes.css">\n'
        '    <script src="tizen-compat.js"></script>\n  </head>', 1)
p.write_text(html, encoding="utf-8")
print("index.html patched.")
PYEOF

# Provide a default settings.js so the manual build still launches (SAWSUBE
# overwrites this with real Navidrome config + auth pre-seed).
if [ ! -f "$TMP_DIR/settings.js" ]; then
  cat > "$TMP_DIR/settings.js" <<'JSEOF'
"use strict";
window.SERVER_URL = "";
window.SERVER_NAME = "";
window.SERVER_TYPE = "";
window.SERVER_LOCK = "false";
window.LEGACY_AUTHENTICATION = "false";
window.ANALYTICS_DISABLED = "true";
window.REMOTE_URL = "";
JSEOF
fi

echo "==> Packaging WGT (profile: $PROFILE)"
cd "$SCRIPT_DIR"
"$TIZEN" package --type wgt --sign "$PROFILE" -o "$SCRIPT_DIR" -- "$TMP_DIR"

# Tizen names the .wgt after the package id — rename to canonical name
NEW_WGT="$(ls -t "$SCRIPT_DIR"/*.wgt 2>/dev/null | head -n1)"
if [ -n "$NEW_WGT" ] && [ "$NEW_WGT" != "$SCRIPT_DIR/$OUT_WGT_NAME" ]; then
  mv -f "$NEW_WGT" "$SCRIPT_DIR/$OUT_WGT_NAME"
fi

echo "==> Done: $SCRIPT_DIR/$OUT_WGT_NAME"
