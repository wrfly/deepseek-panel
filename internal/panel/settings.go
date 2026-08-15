package panel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// TrayDisplay 菜单栏/托盘文字显示内容。
type TrayDisplay string

const (
	// TrayBoth 今日花费 + Token（默认）
	TrayBoth TrayDisplay = "todayBoth"
	// TrayCost 仅今日花费
	TrayCost TrayDisplay = "todayCost"
	// TrayTokens 仅今日 Token
	TrayTokens TrayDisplay = "todayTokens"
	// TrayBalance 余额（原版行为）
	TrayBalance TrayDisplay = "balance"
	// TrayNone 仅图标
	TrayNone TrayDisplay = "none"
)

// Settings 应用设置，对应 Swift AppSettings（UserDefaults）。
type Settings struct {
	RefreshIntervalMinutes int                `json:"refreshIntervalMinutes"`
	Period                 string             `json:"period"`
	DisplayCurrency        string             `json:"displayCurrency"`
	UseMockData            bool               `json:"useMockData"`
	Budget                 float64            `json:"budget"` // 旧版单值预算，仅用于迁移
	DailyBudget            float64            `json:"dailyBudget"`
	MonthlyBudget          float64            `json:"monthlyBudget"`
	KeyBudgets             map[string]float64 `json:"keyBudgets"` // 旧版按 Key 预算，仅用于迁移
	KeyDailyBudgets        map[string]float64 `json:"keyDailyBudgets"`
	KeyMonthlyBudgets      map[string]float64 `json:"keyMonthlyBudgets"`
	HeatmapMetric          string             `json:"heatmapMetric"` // "tokens" | "cost"
	TrayDisplay            string             `json:"trayDisplay"`   // TrayDisplay 常量
}

// WithDefaults 返回带默认值的设置。
func WithDefaults() Settings {
	return Settings{
		RefreshIntervalMinutes: 5,
		Period:                 string(PeriodToday),
		DisplayCurrency:        "CNY",
		UseMockData:            false,
		Budget:                 0,
		DailyBudget:            0,
		MonthlyBudget:          0,
		KeyBudgets:             nil,
		KeyDailyBudgets:        map[string]float64{},
		KeyMonthlyBudgets:      map[string]float64{},
		HeatmapMetric:          "tokens",
		TrayDisplay:            string(TrayBoth),
	}
}

// Normalize 修正非法值。
func (s *Settings) Normalize() {
	if s.RefreshIntervalMinutes <= 0 {
		s.RefreshIntervalMinutes = 5
	}
	if s.Period != string(PeriodToday) && s.Period != string(PeriodLast24h) &&
		s.Period != string(PeriodLast7d) && s.Period != string(PeriodLast30d) &&
		s.Period != string(PeriodThisMonth) && s.Period != string(PeriodLastMonth) {
		s.Period = string(PeriodToday)
	}
	if s.DisplayCurrency != "USD" && s.DisplayCurrency != "CNY" {
		s.DisplayCurrency = "CNY"
	}
	// 旧版单值预算迁移为每日预算（仅迁移一次）
	if s.Budget > 0 && s.DailyBudget == 0 && s.MonthlyBudget == 0 {
		s.DailyBudget = s.Budget
	}
	s.Budget = 0
	// 旧版按 Key 预算（当前周期语义）迁移为每月预算（仅迁移一次）
	if len(s.KeyBudgets) > 0 && len(s.KeyMonthlyBudgets) == 0 {
		s.KeyMonthlyBudgets = s.KeyBudgets
	}
	s.KeyBudgets = nil
	if s.DailyBudget < 0 {
		s.DailyBudget = 0
	}
	if s.MonthlyBudget < 0 {
		s.MonthlyBudget = 0
	}
	if s.KeyDailyBudgets == nil {
		s.KeyDailyBudgets = map[string]float64{}
	}
	if s.KeyMonthlyBudgets == nil {
		s.KeyMonthlyBudgets = map[string]float64{}
	}
	for k, v := range s.KeyDailyBudgets {
		if v < 0 {
			delete(s.KeyDailyBudgets, k)
		}
	}
	for k, v := range s.KeyMonthlyBudgets {
		if v < 0 {
			delete(s.KeyMonthlyBudgets, k)
		}
	}
	if s.HeatmapMetric != "cost" {
		s.HeatmapMetric = "tokens"
	}
	switch TrayDisplay(s.TrayDisplay) {
	case TrayBoth, TrayCost, TrayTokens, TrayBalance, TrayNone:
	default:
		s.TrayDisplay = string(TrayBoth)
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
