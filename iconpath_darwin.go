//go:build darwin

package main

// linuxIconPath macOS 不需要图标文件（标题文字展示）。
func linuxIconPath(_ string) string {
	return ""
}
