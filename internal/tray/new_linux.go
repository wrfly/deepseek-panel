//go:build linux

package tray

import (
	"github.com/wrfly/deepseek-panel/internal/tray/linux"
	"github.com/wrfly/deepseek-panel/internal/traykit"
)

// New 创建 Linux AppIndicator 托盘。iconPath 为托盘图标文件路径。
func New(handlers traykit.Handlers, iconPath string) traykit.Tray {
	return linux.New(handlers, iconPath)
}
