#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release --disable-sandbox

APP_DIR=dist/DeepSeekPanel.app
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

cp .build/release/DeepSeekPanel "$APP_DIR/Contents/MacOS/DeepSeekPanel"
cp App/Info.plist "$APP_DIR/Contents/Info.plist"

if [ ! -f App/AppIcon.icns ]; then
  echo "icon not found, generating…"
  ./scripts/gen_icon.sh
fi
cp App/AppIcon.icns "$APP_DIR/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$APP_DIR"
echo "Built: $APP_DIR"
