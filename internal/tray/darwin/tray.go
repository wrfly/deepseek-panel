//go:build darwin

// Package darwin 基于 NSStatusItem 的 macOS 菜单栏实现。
// 直接挂在 Wails 的 NSApplication 上（同一进程、同一主线程事件循环），
// 全部 AppKit 调用通过 dispatch_async 调度到主队列。
package darwin

/*
#cgo darwin CFLAGS: -x objective-c -fobjc-arc
#cgo darwin LDFLAGS: -framework Cocoa

#include <stdlib.h>

void tray_start(const char *title, const char *tooltip);
void tray_set_text(const char *title, const char *tooltip);
void tray_stop(void);
extern void trayOpenClicked(void);
extern void traySettingsClicked(void);
extern void trayUsageClicked(void);
extern void trayQuitClicked(void);
*/
import "C"

import (
	"sync"
	"unsafe"

	"github.com/wrfly/deepseek-panel/internal/traykit"
)

type darwinTray struct {
	handlers traykit.Handlers
	mu       sync.Mutex
	started  bool
}

// New 创建 macOS 菜单栏托盘。
func New(handlers traykit.Handlers) traykit.Tray {
	return &darwinTray{handlers: handlers}
}

//export trayOpenClicked
func trayOpenClicked() {
	darwinTraySingleton.handlers.OnOpenPanel()
}

//export traySettingsClicked
func traySettingsClicked() {
	darwinTraySingleton.handlers.OnOpenSettings()
}

//export trayUsageClicked
func trayUsageClicked() {
	darwinTraySingleton.handlers.OnOpenUsage()
}

//export trayQuitClicked
func trayQuitClicked() {
	darwinTraySingleton.handlers.OnQuit()
}

var darwinTraySingleton *darwinTray

func (t *darwinTray) Start() {
	t.mu.Lock()
	if t.started {
		t.mu.Unlock()
		return
	}
	t.started = true
	t.mu.Unlock()
	darwinTraySingleton = t

	title := C.CString("🐋 DeepSeek 用量面板")
	tooltip := C.CString("DeepSeek 用量面板")
	defer C.free(unsafe.Pointer(title))
	defer C.free(unsafe.Pointer(tooltip))
	C.tray_start(title, tooltip)
}

func (t *darwinTray) SetText(title, tooltip string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.started {
		return
	}
	ct := C.CString(title)
	cp := C.CString(tooltip)
	defer C.free(unsafe.Pointer(ct))
	defer C.free(unsafe.Pointer(cp))
	C.tray_set_text(ct, cp)
}

func (t *darwinTray) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.started {
		return
	}
	t.started = false
	C.tray_stop()
}
