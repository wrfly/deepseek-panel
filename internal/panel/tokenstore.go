package panel

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// TokenStore Bearer Token 存储。
// macOS 版使用钥匙串（Keychain）；跨平台合并版统一使用本地文件
// （0600 权限），路径为 <用户配置目录>/deepseek-panel/token。
type TokenStore struct {
	mu   sync.RWMutex
	path string
}

// NewTokenStore 创建 Token 存储。
func NewTokenStore(configDir string) *TokenStore {
	path := filepath.Join(configDir, "deepseek-panel", "token")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	return &TokenStore{path: path}
}

// Load 读取 Token，不存在返回空串。
func (t *TokenStore) Load() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	data, err := os.ReadFile(t.path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// Save 保存 Token（去首尾空白）。
func (t *TokenStore) Save(token string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	token = strings.TrimSpace(token)
	_ = os.MkdirAll(filepath.Dir(t.path), 0o755)
	if err := os.WriteFile(t.path, []byte(token), 0o600); err != nil {
		return err
	}
	return nil
}
