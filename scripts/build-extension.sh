#!/bin/bash
# 同步前端资源到扩展目录并做语法校验（在仓库根目录执行）。
# 加载方式：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 extension/ 目录。
set -e
cd "$(dirname "$0")/.."

rm -rf extension/frontend-dist
cp -r frontend/dist extension/frontend-dist

for f in extension/background.js extension/popup.js extension/lib/*.js; do
  node --check "$f"
done
node extension/test.mjs

echo "扩展就绪：加载 extension/ 目录即可（chrome://extensions → 开发者模式 → 加载已解压的扩展程序）"
