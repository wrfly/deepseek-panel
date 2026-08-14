//go:build linux

// Package linux 基于 libayatana-appindicator 的 Linux 托盘实现。
// 全部 GTK 调用通过 g_idle_add 调度到 Wails 的 GTK 主循环，不额外启动事件循环。
package linux

/*
#cgo linux pkg-config: ayatana-appindicator3-0.1
#include <stdlib.h>

// 由 tray_linux.c 实现
void tray_start(const char *icon_path, const char *title, const char *tooltip);
void tray_set_text(const char *title, const char *tooltip);
void tray_stop(void);
// 由 cgo 导出，C 侧菜单回调
extern void trayOpenClicked(void);
extern void traySettingsClicked(void);
extern void trayUsageClicked(void);
extern void trayQuitClicked(void);
*/
import "C"

import (
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"github.com/wrfly/deepseek-panel/internal/icon"
	"github.com/wrfly/deepseek-panel/internal/traykit"
)

// IconPath 把托盘图标写入配置目录并返回路径。
func IconPath(configDir string) string {
	dir := filepath.Join(configDir, "deepseek-panel")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}
	path := filepath.Join(dir, "whale.png")
	if err := os.WriteFile(path, icon.PNG, 0o644); err != nil {
		return ""
	}
	return path
}

type linuxTray struct {
	handlers traykit.Handlers
	iconPath string
	title    string
	tooltip  string
	mu       sync.Mutex
	started  bool
}

// New 创建 Linux 托盘。
func New(handlers traykit.Handlers, iconPath string) traykit.Tray {
	return &linuxTray{handlers: handlers, iconPath: iconPath}
}

//export trayOpenClicked
func trayOpenClicked() {
	current().handlers.OnOpenPanel()
}

//export traySettingsClicked
func traySettingsClicked() {
	current().handlers.OnOpenSettings()
}

//export trayUsageClicked
func trayUsageClicked() {
	current().handlers.OnOpenUsage()
}

//export trayQuitClicked
func trayQuitClicked() {
	current().handlers.OnQuit()
}

func current() *linuxTray {
	return linuxTraySingleton
}

var linuxTraySingleton *linuxTray

func (t *linuxTray) Start() {
	t.mu.Lock()
	if t.started {
		t.mu.Unlock()
		return
	}
	t.started = true
	t.mu.Unlock()
	linuxTraySingleton = t

	icon := C.CString(t.iconPath)
	title := C.CString("DeepSeek 用量面板")
	tooltip := C.CString("DeepSeek 用量面板")
	defer C.free(unsafe.Pointer(icon))
	defer C.free(unsafe.Pointer(title))
	defer C.free(unsafe.Pointer(tooltip))
	C.tray_start(icon, title, tooltip)
}

func (t *linuxTray) SetText(title, tooltip string) {
	t.mu.Lock()
	t.title = title
	t.tooltip = tooltip
	t.mu.Unlock()
	if !t.started {
		return
	}
	ct := C.CString(title)
	cp := C.CString(tooltip)
	defer C.free(unsafe.Pointer(ct))
	defer C.free(unsafe.Pointer(cp))
	C.tray_set_text(ct, cp)
}

func (t *linuxTray) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.started {
		return
	}
	t.started = false
	C.tray_stop()
}
