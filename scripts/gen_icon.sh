#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

swift App/gen_icon.swift App/icon-1024.png

ICONSET=App/AppIcon.iconset
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" App/icon-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" App/icon-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o App/AppIcon.icns
echo "generated App/AppIcon.icns"
