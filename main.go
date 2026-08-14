package main

import (
	"embed"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/wrfly/deepseek-panel/internal/icon"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/wrfly/deepseek-panel/internal/deepseek"
	"github.com/wrfly/deepseek-panel/internal/panel"
)

//go:embed all:frontend/dist
var assets embed.FS

// lockFile 单实例锁（跨平台 flock）。
var lockFile *os.File

func main() {
	ensureXdgRuntimeDir()

	if os.Getenv("DEEPSEEK_PANEL_DEBUG") == "1" {
		fmt.Fprintln(os.Stdout, "DEBUG args:", os.Args)
	}

	a := NewApp()

	// 无界面自测：--dump
	if hasArg("--dump") {
		cfgDir, err := os.UserConfigDir()
		if err != nil {
			cfgDir = "."
		}
		token := os.Getenv("DEEPSEEK_PANEL_TEST_TOKEN")
		if token == "" {
			token = panel.NewTokenStore(cfgDir).Load()
		}
		settings := panel.NewSettingsStore(cfgDir).Get()
		panel.Dump(deepseek.New(token), a.mock, settings, token)
		return
	}

	// 防止重复启动；已运行时尝试唤起第一个实例的窗口。
	if !acquireLock() {
		if notifyRunningInstance() {
			fmt.Println("DeepSeek 用量面板已在运行，已唤起其窗口")
		} else {
			fmt.Println("DeepSeek 用量面板已在运行")
		}
		return
	}
	defer releaseLock()
	listenShowRequests(a)

	err := wails.Run(&options.App{
		Title:             "DeepSeek 用量面板",
		Width:             420,
		Height:            920,
		MinWidth:          380,
		MinHeight:         640,
		StartHidden:       runtime.GOOS == "darwin",
		HideWindowOnClose: true,
		BackgroundColour:  &options.RGBA{R: 24, G: 26, B: 32, A: 1},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  a.Startup,
		OnShutdown: a.Shutdown,
		Bind:       []interface{}{a},
		Linux: &linux.Options{
			ProgramName:      "deepseek-panel",
			WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand,
			Icon:             icon.PNG,
		},
		Mac: &mac.Options{
			Appearance: mac.DefaultAppearance,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

// ensureXdgRuntimeDir 保证 XDG_RUNTIME_DIR 存在（WebKitGTK 需要它初始化窗口；
// 桌面会话里由系统提供，最小环境下回退到用户目录）。
func ensureXdgRuntimeDir() {
	if os.Getenv("XDG_RUNTIME_DIR") != "" {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	dir := filepath.Join(home, ".cache", "deepseek-panel", "xdg-runtime")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	_ = os.Setenv("XDG_RUNTIME_DIR", dir)
}

func hasArg(name string) bool {
	for _, arg := range os.Args {
		if arg == name {
			return true
		}
	}
	return false
}

func acquireLock() bool {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = "."
	}
	dir := cfgDir + string(os.PathSeparator) + "deepseek-panel"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return true
	}
	lockFile, err = os.OpenFile(dir+string(os.PathSeparator)+"app.lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return true
	}
	if err := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return false
	}
	return true
}

func releaseLock() {
	if lockFile != nil {
		_ = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
		_ = lockFile.Close()
	}
}

// showSocketPath 返回唤醒 socket 路径。
func showSocketPath() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = "."
	}
	return filepath.Join(cfgDir, "deepseek-panel", "app.sock")
}

// notifyRunningInstance 尝试连接已运行实例并请求显示窗口。
func notifyRunningInstance() bool {
	conn, err := net.Dial("unix", showSocketPath())
	if err != nil {
		return false
	}
	defer conn.Close()
	_, _ = conn.Write([]byte("show\n"))
	return true
}

// listenShowRequests 监听唤醒请求：第二个实例启动时让本实例窗口前置。
func listenShowRequests(a *App) {
	sockPath := showSocketPath()
	_ = os.Remove(sockPath)
	listener, err := net.Listen("unix", sockPath)
	if err != nil {
		return
	}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			buf := make([]byte, 32)
			n, _ := conn.Read(buf)
			conn.Close()
			if n > 0 && string(buf[:n]) == "show\n" {
				a.ShowPanel()
			}
		}
	}()
}
