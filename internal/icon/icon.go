// Package icon 共享应用图标资源（窗口图标 + Linux 托盘图标，多尺寸）。
package icon

import _ "embed"

//go:embed whale.png
var PNG []byte

//go:embed whale-22.png
var PNG22 []byte

//go:embed whale-24.png
var PNG24 []byte

//go:embed whale-32.png
var PNG32 []byte

//go:embed whale-48.png
var PNG48 []byte

//go:embed whale-64.png
var PNG64 []byte
