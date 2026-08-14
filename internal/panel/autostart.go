package panel

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Autostart 开机自启管理。
// Linux：XDG autostart desktop 文件；macOS：LaunchAgent plist。
type Autostart struct {
	configDir string
}

// NewAutostart 创建自启管理器。
func NewAutostart(configDir string) *Autostart {
	return &Autostart{configDir: configDir}
}

// Label 应用标识。
const label = "DeepSeek 用量面板"

// Enable 启用开机自启。
func (a *Autostart) Enable() error {
	if runtime.GOOS == "linux" {
		return a.enableLinux()
	}
	if runtime.GOOS == "darwin" {
		return a.enableMac()
	}
	return nil
}

// Disable 禁用开机自启。
func (a *Autostart) Disable() error {
	if runtime.GOOS == "linux" {
		return a.disableLinux()
	}
	if runtime.GOOS == "darwin" {
		return a.disableMac()
	}
	return nil
}

// IsEnabled 查询开机自启状态。
func (a *Autostart) IsEnabled() bool {
	if runtime.GOOS == "linux" {
		_, err := os.Stat(a.linuxPath())
		return err == nil
	}
	if runtime.GOOS == "darwin" {
		_, err := os.Stat(a.macPath())
		return err == nil
	}
	return false
}

func (a *Autostart) linuxPath() string {
	return filepath.Join(a.configDir, "autostart", "deepseek-panel.desktop")
}

func (a *Autostart) enableLinux() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if abs, err := filepath.Abs(exe); err == nil {
		exe = abs
	}
	path := a.linuxPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	content := "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=" + label + "\n" +
		"Comment=DeepSeek 平台用量面板\n" +
		"Exec=\"" + exe + "\"\n" +
		"Terminal=false\n" +
		"X-GNOME-Autostart-enabled=true\n"
	return os.WriteFile(path, []byte(content), 0o644)
}

func (a *Autostart) disableLinux() error {
	err := os.Remove(a.linuxPath())
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (a *Autostart) macPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.local.deepseek-panel.plist")
}

func (a *Autostart) enableMac() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	path := a.macPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>com.local.deepseek-panel</string>
	<key>ProgramArguments</key>
	<array><string>EXE</string></array>
	<key>RunAtLoad</key><true/>
	<key>ProcessType</key><string>Background</string>
</dict>
</plist>
`
	plist = strings.ReplaceAll(plist, "EXE", strings.ReplaceAll(exe, "&", "&amp;"))
	return os.WriteFile(path, []byte(plist), 0o644)
}

func (a *Autostart) disableMac() error {
	err := os.Remove(a.macPath())
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
