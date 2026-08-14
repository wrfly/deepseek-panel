package panel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Settings 应用设置，对应 Swift AppSettings（UserDefaults）。
type Settings struct {
	RefreshIntervalMinutes int     `json:"refreshIntervalMinutes"`
	Period                 string  `json:"period"`
	DisplayCurrency        string  `json:"displayCurrency"`
	UseMockData            bool    `json:"useMockData"`
	Budget                 float64 `json:"budget"`
	HeatmapMetric          string  `json:"heatmapMetric"` // "tokens" | "cost"
}

// WithDefaults 返回带默认值的设置。
func WithDefaults() Settings {
	return Settings{
		RefreshIntervalMinutes: 5,
		Period:                 string(PeriodToday),
		DisplayCurrency:        "CNY",
		UseMockData:            false,
		Budget:                 0,
		HeatmapMetric:          "tokens",
	}
}

// Normalize 修正非法值。
func (s *Settings) Normalize() {
	if s.RefreshIntervalMinutes <= 0 {
		s.RefreshIntervalMinutes = 5
	}
	if s.Period != string(PeriodToday) && s.Period != string(PeriodLast24h) &&
		s.Period != string(PeriodLast7d) && s.Period != string(PeriodThisMonth) {
		s.Period = string(PeriodToday)
	}
	if s.DisplayCurrency != "USD" && s.DisplayCurrency != "CNY" {
		s.DisplayCurrency = "CNY"
	}
	if s.Budget < 0 {
		s.Budget = 0
	}
	if s.HeatmapMetric != "cost" {
		s.HeatmapMetric = "tokens"
	}
}

// SettingsStore 线程安全的设置持久化（JSON 文件）。
type SettingsStore struct {
	mu       sync.RWMutex
	settings Settings
	path     string
}

// NewSettingsStore 创建设置存储，不存在时使用默认值。
func NewSettingsStore(configDir string) *SettingsStore {
	path := filepath.Join(configDir, "deepseek-panel", "settings.json")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	s := &SettingsStore{settings: WithDefaults(), path: path}
	if data, err := os.ReadFile(path); err == nil {
		var loaded Settings
		if json.Unmarshal(data, &loaded) == nil {
			loaded.Normalize()
			s.settings = loaded
		}
	}
	return s
}

// Get 返回当前设置副本。
func (s *SettingsStore) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings
}

// Save 保存设置（自动 Normalize）。
func (s *SettingsStore) Save(settings Settings) {
	settings.Normalize()
	s.mu.Lock()
	s.settings = settings
	s.mu.Unlock()
	data, err := json.Marshal(settings)
	if err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, data, 0o644) != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
}
