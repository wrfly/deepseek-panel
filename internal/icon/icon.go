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

// 透明占位图标：Linux 托盘用纯 emoji 标题充当图标，
// AppIndicator 仍需要图标名，安装透明 png 使其不可见。
//
//go:embed transparent-22.png
var Transparent22 []byte

//go:embed transparent-24.png
var Transparent24 []byte

//go:embed transparent-32.png
var Transparent32 []byte

//go:embed transparent-48.png
var Transparent48 []byte

//go:embed transparent-64.png
var Transparent64 []byte
