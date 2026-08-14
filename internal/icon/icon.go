// Package icon 共享应用图标资源（窗口图标 + Linux 托盘图标）。
package icon

import _ "embed"

//go:embed whale.png
var PNG []byte
