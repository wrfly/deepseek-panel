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

// IconName 托盘图标在图标主题中的名称。
// 注意：GNOME AppIndicator 扩展会在 shell 进程内按图标名缓存图标，
// 更换图标图片后需要同时改名（版本后缀），否则旧图标不会刷新。
const IconName = "deepseek-panel-transparent"

// InstallIcon 把托盘图标安装到用户图标主题（~/.local/share/icons/hicolor），
// 返回供 AppIndicator 使用的图标名；失败时返回空串（AppIndicator 仍可显示标题）。
func InstallIcon(configDir string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	// 也保留一份在配置目录，便于排查。
	cfgDir := filepath.Join(configDir, "deepseek-panel")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return ""
	}
	_ = os.WriteFile(filepath.Join(cfgDir, "whale.png"), icon.PNG, 0o644)

	// hicolor 主题是 GTK 的默认回退主题，无需 index.theme 也能被找到。
	// 安装透明图标：AppIndicator 必须有图标名，但视觉上由标题里的 🐋 emoji 充当。
	installed := false
	sizes := []struct {
		dir  string
		data []byte
	}{
		{"22x22", icon.Transparent22},
		{"24x24", icon.Transparent24},
		{"32x32", icon.Transparent32},
		{"48x48", icon.Transparent48},
		{"64x64", icon.Transparent64},
	}
	for _, s := range sizes {
		dir := filepath.Join(home, ".local", "share", "icons", "hicolor", s.dir, "status")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, IconName+".png"), s.data, 0o644); err == nil {
			installed = true
		}
	}
	if !installed {
		return ""
	}
	return IconName
}

type linuxTray struct {
	handlers traykit.Handlers
	iconPath string
	title    string
	tooltip  string
	mu       sync.Mutex
	started  bool
}

// New 创建 Linux 托盘。iconPath 为 AppIndicator 图标名（InstallIcon 的返回值）。
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
