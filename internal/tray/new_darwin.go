//go:build darwin

package tray

import (
	"github.com/wrfly/deepseek-panel/internal/tray/darwin"
	"github.com/wrfly/deepseek-panel/internal/traykit"
)

// New 创建 macOS 菜单栏托盘（NSStatusItem）。图标通过标题文字展示，iconPath 可为空。
func New(handlers traykit.Handlers, iconPath string) traykit.Tray {
	return darwin.New(handlers)
}
