// Package traykit 定义跨平台托盘共享类型（叶子包，避免父子包循环引用）。
package traykit

// Handlers 托盘菜单回调。
type Handlers struct {
	OnOpenPanel    func()
	OnOpenSettings func()
	OnOpenUsage    func()
	OnQuit         func()
}

// Tray 系统托盘/菜单栏接口。
type Tray interface {
	// Start 创建托盘（应用事件循环启动后调用）。
	Start()
	// SetText 更新标题与提示（线程安全）。
	SetText(title, tooltip string)
	// Stop 移除托盘。
	Stop()
}
