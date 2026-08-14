#!/bin/bash
# 在 macOS 上构建 DeepSeekPanel.app（与 Linux 版同一份代码）。
# 产物：build/DeepSeekPanel.app
set -e
cd "$(dirname "$0")/.."

APP=build/DeepSeekPanel.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> go build (darwin)"
go build -tags "production" -o "$APP/Contents/MacOS/deepseek-panel" .

echo "==> Info.plist（LSUIElement：仅菜单栏，无 Dock 图标）"
cp App/Info.plist "$APP/Contents/Info.plist"

echo "==> 图标"
if command -v iconutil >/dev/null 2>&1 && [ -f internal/icon/whale.png ]; then
  ICONSET=$(mktemp -d)/icon.iconset
  mkdir -p "$ICONSET"
  for s in 16 32 64 128 256 512; do
    sips -z $s $s internal/icon/whale.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2))
    sips -z $d $d internal/icon/whale.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
fi

echo "==> 签名（Apple Silicon 需要 ad-hoc 签名）"
codesign --force --deep -s - "$APP" 2>/dev/null || true

echo "==> 完成：$APP"
echo "    复制到 /Applications 后，首次启动请在菜单栏图标 → 设置中粘贴 Token。"