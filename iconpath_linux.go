//go:build linux

package main

import "github.com/wrfly/deepseek-panel/internal/tray/linux"

// linuxIconPath 返回 Linux 托盘图标路径。
func linuxIconPath(configDir string) string {
	return linux.InstallIcon(configDir)
}