#!/bin/bash
# 无 root 权限时准备 Linux GUI 构建依赖（webkit2gtk-4.1 / gtk3 / appindicator 开发包）。
# 有 root 权限时直接：sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
#
# 原理：apt-get download 下载 .deb 并解压到 ~/.local/pkg，
# 通过 PKG_CONFIG_PATH + PKG_CONFIG_SYSROOT_DIR 提供给 cgo 使用；
# 再把系统里已装的依赖头文件同步进同一前缀，保证 -I 路径一致。
set -e
PREFIX="$HOME/.local/pkg"
DEBS="$HOME/.local/dpkg-debs"
PKGCFG="$PREFIX/usr/lib/x86_64-linux-gnu/pkgconfig"

if pkg-config --exists webkit2gtk-4.1 gtk+-3.0 ayatana-appindicator3-0.1; then
  echo "开发包已就绪，无需处理。"
  exit 0
fi

mkdir -p "$DEBS" "$PKGCFG"
cd "$DEBS"

echo "==> 解析依赖清单（apt-get install --print-uris，无需 root）"
apt-get install --print-uris -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev > uris.txt 2>&1 || true

echo "==> 并行下载"
grep "^'" uris.txt | awk -F"'" '{print $2}' | xargs -P 8 -I{} sh -c 'curl -fsSL -O "{}" || echo "download failed: {}"'

echo "==> 解压到 $PREFIX"
mkdir -p "$PREFIX"
for d in *.deb; do dpkg -x "$d" "$PREFIX"; done

echo "==> 同步系统已装依赖的头文件（glib 等）"
export PKG_CONFIG_PATH="$PKGCFG"
export PKG_CONFIG_SYSROOT_DIR="$PREFIX"
flags=$(pkg-config --cflags webkit2gtk-4.1 gtk+-3.0 ayatana-appindicator3-0.1 2>/dev/null || true)
for d in $(echo "$flags" | tr ' ' '\n' | grep '^-I' | sed 's/^-I//'); do
  if [ ! -d "$d" ]; then
    rel=$(echo "$d" | sed "s|^$PREFIX||")
    src="$rel"
    if [ -d "$src" ]; then
      mkdir -p "$(dirname "$d")"
      cp -a "$src" "$d"
    fi
  fi
done

echo "==> 修复 .so 符号链接（指向系统运行库）"
cd "$PREFIX/usr/lib/x86_64-linux-gnu"
for f in *.so; do
  tgt=$(readlink "$f")
  if [ -n "$tgt" ] && [ ! -e "$f" ] && [ -e "/usr/lib/x86_64-linux-gnu/$tgt" ]; then
    ln -sf "/usr/lib/x86_64-linux-gnu/$tgt" "$f"
  fi
done

echo "==> 完成。构建时请带上环境变量："
echo "    export PKG_CONFIG_PATH=$PKGCFG"
echo "    export PKG_CONFIG_SYSROOT_DIR=$PREFIX"