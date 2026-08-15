package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/wrfly/deepseek-panel/internal/deepseek"
	"github.com/wrfly/deepseek-panel/internal/panel"
	"github.com/wrfly/deepseek-panel/internal/tray"
	"github.com/wrfly/deepseek-panel/internal/traykit"
)

// ---- 与前端约定的 JSON 结构 ----

// KeyRow 单个 Key 的用量行。
type KeyRow struct {
	Name                  string   `json:"name"`
	Requests              int64    `json:"requests"`
	TotalTokens           int64    `json:"totalTokens"`
	CacheHitRate          *float64 `json:"cacheHitRate"`
	Cost                  float64  `json:"cost"`
	CostCNY               float64  `json:"costCNY"`
	CostUSD               float64  `json:"costUSD"`
	PromptCacheHitTokens  int64    `json:"promptCacheHitTokens"`
	PromptCacheMissTokens int64    `json:"promptCacheMissTokens"`
	ResponseTokens        int64    `json:"responseTokens"`
}

// ModelRow 单个模型的用量行。
type ModelRow struct {
	Name   string  `json:"name"`
	Tokens int64   `json:"tokens"`
	Cost   float64 `json:"cost"`
}

// TrendPointJSON 趋势点。
type TrendPointJSON struct {
	Time    int64   `json:"time"`
	Tokens  int64   `json:"tokens"`
	CostCNY float64 `json:"costCNY"`
	CostUSD float64 `json:"costUSD"`
}

// ReportJSON 聚合报告。
type ReportJSON struct {
	Keys          []KeyRow         `json:"keys"`
	Models        []ModelRow       `json:"models"`
	Trend         []TrendPointJSON `json:"trend"`
	TotalTokens   int64            `json:"totalTokens"`
	TotalCost     float64          `json:"totalCost"`
	HitTokens     int64            `json:"hitTokens"`
	MissTokens    int64            `json:"missTokens"`
	TotalRequests int64            `json:"totalRequests"`
}

// SettingsJSON 设置（前端 ↔ 后端）。
type SettingsJSON struct {
	RefreshIntervalMinutes int     `json:"refreshIntervalMinutes"`
	Period                 string  `json:"period"`
	DisplayCurrency        string  `json:"displayCurrency"`
	UseMockData            bool    `json:"useMockData"`
	Budget                 float64 `json:"budget"`
	HeatmapMetric          string  `json:"heatmapMetric"`
	TrayDisplay            string  `json:"trayDisplay"`
	HasToken               bool    `json:"hasToken"`
	LaunchAtLogin          bool    `json:"launchAtLogin"`
}

// Snapshot 一次刷新后的完整快照。
type Snapshot struct {
	Summary      *deepseek.UserSummary `json:"summary"`
	Report       ReportJSON            `json:"report"`
	Currency     string                `json:"currency"`
	Period       string                `json:"period"`
	PeriodTitle  string                `json:"periodTitle"`
	LastUpdated  *int64                `json:"lastUpdated"`
	ErrorMessage string                `json:"errorMessage"`
	IsLoading    bool                  `json:"isLoading"`
	Heatmap      [][]panel.HeatmapCell `json:"heatmap"`
	HeatmapStart int64                 `json:"heatmapStart"`
	Budget       float64               `json:"budget"`
	BudgetRatio  *float64              `json:"budgetRatio"`
	Settings     SettingsJSON          `json:"settings"`
	TrayTitle    string                `json:"trayTitle"`
	TrayTooltip  string                `json:"trayTooltip"`
}

// App Wails 绑定与刷新逻辑。
type App struct {
	ctx       context.Context
	settings  *panel.SettingsStore
	tokens    *panel.TokenStore
	trend     *panel.TrendStore
	autostart *panel.Autostart
	mock      panel.MockData

	mu              sync.Mutex
	snapshot        Snapshot
	failureStreak   int
	lastHourlyFetch time.Time
	refreshing      bool

	tray  traykit.Tray
	navCh chan string
}

// NewApp 初始化应用。
func NewApp() *App {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = "."
	}
	return &App{
		settings:  panel.NewSettingsStore(cfgDir),
		tokens:    panel.NewTokenStore(cfgDir),
		trend:     panel.NewTrendStore(cfgDir),
		autostart: panel.NewAutostart(cfgDir),
		mock:      panel.MockData{},
		navCh:     make(chan string, 4),
	}
}

// ---- Wails 生命周期 ----

// Startup wails.OnStartup。
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// 托盘
	var iconPath string
	if runtime.GOOS == "linux" {
		cfgDir, _ := os.UserConfigDir()
		iconPath = linuxIconPath(cfgDir)
	}
	a.tray = tray.New(traykit.Handlers{
		OnOpenPanel:    func() { a.navCh <- "panel" },
		OnOpenSettings: func() { a.navCh <- "settings" },
		OnOpenUsage:    a.OpenUsagePage,
		OnQuit:         a.Quit,
	}, iconPath)
	a.tray.Start()

	go a.consumeNav()
	go a.refresh()
	go a.loop()

	// 调试：打印窗口状态
	go func() {
		time.Sleep(3 * time.Second)
		if os.Getenv("DEEPSEEK_PANEL_DEBUG") == "1" {
			x, y := wailsruntime.WindowGetPosition(ctx)
			w, h := wailsruntime.WindowGetSize(ctx)
			fmt.Fprintf(os.Stderr, "DEBUG window: pos=(%d,%d) size=(%dx%d) minimized=%v\n",
				x, y, w, h, wailsruntime.WindowIsMinimised(ctx))
		}
	}()
}

// Shutdown wails.OnShutdown。
func (a *App) Shutdown(_ context.Context) {
	if a.tray != nil {
		a.tray.Stop()
	}
}

// ShowPanel 显示主窗口（供托盘与二次启动唤醒调用）。
func (a *App) ShowPanel() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowShow(a.ctx)
	wailsruntime.WindowSetAlwaysOnTop(a.ctx, true)
	wailsruntime.WindowSetAlwaysOnTop(a.ctx, false)
	wailsruntime.EventsEmit(a.ctx, "nav", "panel")
}

// consumeNav 托盘导航：显示窗口并通知前端切换页面。
func (a *App) consumeNav() {
	for page := range a.navCh {
		if a.ctx == nil {
			continue
		}
		wailsruntime.WindowShow(a.ctx)
		wailsruntime.WindowSetAlwaysOnTop(a.ctx, true)
		wailsruntime.WindowSetAlwaysOnTop(a.ctx, false)
		wailsruntime.EventsEmit(a.ctx, "nav", page)
	}
}

// loop 定时刷新循环（失败退避，与 Swift 一致）。
func (a *App) loop() {
	for {
		minutes := a.settings.Get().RefreshIntervalMinutes
		streak := a.failureStreak
		if streak > 3 {
			streak = 3
		}
		multiplier := 1 << uint(streak)
		time.Sleep(time.Duration(minutes) * time.Minute * time.Duration(multiplier))
		a.refresh()
	}
}

// ---- 数据刷新 ----

// refresh 拉取数据并发布快照。可并发调用，内部互斥。
func (a *App) refresh() {
	a.mu.Lock()
	if a.refreshing {
		a.mu.Unlock()
		return
	}
	a.refreshing = true
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.refreshing = false
		a.mu.Unlock()
	}()

	settings := a.settings.Get()
	useMock := settings.UseMockData || os.Getenv("DEEPSEEK_PANEL_MOCK") == "1"
	period := panel.ParsePeriod(settings.Period)
	now := time.Now()
	window := period.Window(now)
	tz := panel.LocalTZOffset(now)

	snap := Snapshot{
		Currency:    settings.DisplayCurrency,
		Period:      string(period),
		PeriodTitle: period.Title(),
		Budget:      settings.Budget,
		Settings:    a.settingsJSON(settings),
	}

	if useMock {
		summary, keys, amount, cost := a.mock.Fetch(window, tz)
		report := panel.Build(keys, *amount, *cost, window, settings.DisplayCurrency)
		snap.Summary = summary
		snap.Report = a.reportJSON(report, settings.DisplayCurrency)
		snap.Heatmap = panel.MockHeatmap(a.mock, tz, settings.DisplayCurrency, now)
		snap.HeatmapStart = panel.HeatmapStartMonday(now).Unix()
		ts := now.Unix()
		snap.LastUpdated = &ts
		a.mu.Lock()
		a.failureStreak = 0
		a.mu.Unlock()
	} else {
		token := a.token()
		if token == "" {
			snap.ErrorMessage = "尚未配置 Token，请在“设置”中填写。"
		} else {
			client := deepseek.New(token)
			a.ensureHourlyHistory(client, now, tz)
			summary, keys, amount, cost, err := a.fetchAll(client, window, tz)
			if err != nil {
				snap.ErrorMessage = deepseek.MessageForError(err)
				prev := a.currentSnapshot()
				snap.Summary = prev.Summary
				snap.Report = prev.Report
				snap.Heatmap = prev.Heatmap
				snap.HeatmapStart = prev.HeatmapStart
				snap.LastUpdated = prev.LastUpdated
				a.mu.Lock()
				a.failureStreak++
				a.mu.Unlock()
			} else {
				report := panel.Build(keys, *amount, *cost, window, settings.DisplayCurrency)
				fetched := report.Trend
				if period == panel.PeriodToday {
					a.trend.ReplaceDay(fetched, window.RequestStart, window.RequestEnd)
				}
				report.Trend = a.combinedTrend(window, fetched)
				snap.Summary = summary
				snap.Report = a.reportJSON(report, settings.DisplayCurrency)
				ts := now.Unix()
				snap.LastUpdated = &ts
				a.mu.Lock()
				a.failureStreak = 0
				a.mu.Unlock()
			}
			heatmap, start := panel.BuildHeatmap(a.trend.Points(), settings.DisplayCurrency, now)
			snap.Heatmap = heatmap
			snap.HeatmapStart = start
		}
	}

	if settings.Budget > 0 {
		ratio := snap.Report.TotalCost / settings.Budget
		snap.BudgetRatio = &ratio
	}
	if snap.Summary == nil && snap.ErrorMessage == "" && snap.Report.TotalTokens == 0 {
		snap.IsLoading = true
	}
	snap.TrayTitle, snap.TrayTooltip = a.trayText(&snap, settings)

	a.mu.Lock()
	a.snapshot = snap
	a.mu.Unlock()

	if a.tray != nil {
		a.tray.SetText(snap.TrayTitle, snap.TrayTooltip)
	}
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, "snapshot", snap)
	}
	if os.Getenv("DEEPSEEK_PANEL_DEBUG") == "1" {
		nonZero := 0
		var maxV float64
		for _, row := range snap.Heatmap {
			for _, c := range row {
				if c.Tokens > 0 || c.Cost > 0 {
					nonZero++
				}
				if v := float64(c.Tokens); v > maxV {
					maxV = v
				}
			}
		}
		fmt.Fprintf(os.Stderr, "DEBUG snapshot: period=%s tokens=%d cost=%.2f keys=%d trend=%d heatmap=%d nonZero=%d maxToken=%.0f err=%q\n",
			snap.Period, snap.Report.TotalTokens, snap.Report.TotalCost,
			len(snap.Report.Keys), len(snap.Report.Trend), len(snap.Heatmap), nonZero, maxV, snap.ErrorMessage)
	}
}

// fetchAll 并发拉取 summary/keys/amount/cost。
func (a *App) fetchAll(client *deepseek.Client, window panel.StatsWindow, tz int) (
	*deepseek.UserSummary, []deepseek.APIKeyInfo, *deepseek.UsageAmountData, *deepseek.CostData, error,
) {
	type result struct {
		summary *deepseek.UserSummary
		keys    []deepseek.APIKeyInfo
		amount  *deepseek.UsageAmountData
		cost    *deepseek.CostData
		err     error
	}
	ch := make(chan result, 4)
	go func() {
		s, err := client.FetchSummary()
		ch <- result{summary: s, err: err}
	}()
	go func() {
		k, err := client.FetchKeys()
		ch <- result{keys: k, err: err}
	}()
	go func() {
		am, err := client.FetchAmount(window.RequestStart, window.RequestEnd, tz)
		ch <- result{amount: am, err: err}
	}()
	go func() {
		c, err := client.FetchCost(window.RequestStart, window.RequestEnd, tz)
		ch <- result{cost: c, err: err}
	}()

	var out result
	for i := 0; i < 4; i++ {
		r := <-ch
		if r.err != nil {
			if out.err == nil {
				out.err = r.err
			}
			continue
		}
		if r.summary != nil {
			out.summary = r.summary
		}
		if r.keys != nil {
			out.keys = r.keys
		}
		if r.amount != nil {
			out.amount = r.amount
		}
		if r.cost != nil {
			out.cost = r.cost
		}
	}
	if out.err != nil {
		return nil, nil, nil, nil, out.err
	}
	return out.summary, out.keys, out.amount, out.cost, nil
}

// ensureHourlyHistory 主动回填最近 24 周（168 天）的按小时数据；
// 已缓存的日期不再远程拉取。用量接口要求跨天查询跨度 ≤31 天，按每批 28 天分批。
func (a *App) ensureHourlyHistory(client *deepseek.Client, now time.Time, tz int) {
	todayStart := startOfDay(now)
	const totalDays = 24 * 7 // 168 天，与热力图 24 周一致

	// 历史（不含今天）：从最远的 167 天往今天方向回填。
	// 注意：start 必须是较早的日期、end 是较晚的日期（原 Swift 版此处参数反了，
	// 导致历史批次被接口拒绝、热力图一直没有历史数据）。
	earliestOffset := totalDays - 1
	for earliestOffset > 0 {
		batchDays := earliestOffset
		if batchDays > 28 {
			batchDays = 28
		}
		endOffset := earliestOffset
		startOffset := earliestOffset - batchDays + 1
		startDay := todayStart.AddDate(0, 0, -endOffset)
		endDay := todayStart.AddDate(0, 0, -startOffset)
		start := startDay.Unix()
		end := endDay.Unix() + 86400
		if a.trend.CoverageCount(start, end) < int64(batchDays)*24 {
			a.fetchAndMergeRange(client, start, end, tz)
		}
		earliestOffset -= batchDays
	}

	// 今天：数据仍在增长，按 15 分钟节流持续补齐。
	if a.shouldFetchTodayHourly(now) {
		a.lastHourlyFetch = now
		a.fetchAndMergeRange(client, todayStart.Unix(), todayStart.Unix()+86400, tz)
	}
}

// shouldFetchTodayHourly 今天的小时数据最多每 15 分钟补一次。
func (a *App) shouldFetchTodayHourly(now time.Time) bool {
	if a.lastHourlyFetch.IsZero() {
		return true
	}
	return now.Sub(a.lastHourlyFetch) >= 15*time.Minute
}

// fetchAndMergeRange 拉取 [start, end) 的 amount + cost 并合并进 TrendStore。
// 注意：goroutine 无论成败都必须向通道发送结果，否则主协程会永久阻塞（死锁）。
func (a *App) fetchAndMergeRange(client *deepseek.Client, start, end int64, tz int) {
	type result struct {
		amount *deepseek.UsageAmountData
		cost   *deepseek.CostData
		err    error
	}
	ch := make(chan result, 2)
	go func() {
		am, err := client.FetchAmount(start, end, tz)
		ch <- result{amount: am, err: err}
	}()
	go func() {
		c, err := client.FetchCost(start, end, tz)
		ch <- result{cost: c, err: err}
	}()

	var amount *deepseek.UsageAmountData
	var cost *deepseek.CostData
	for i := 0; i < 2; i++ {
		r := <-ch
		if r.err != nil {
			if os.Getenv("DEEPSEEK_PANEL_DEBUG") == "1" {
				fmt.Fprintf(os.Stderr, "DEBUG backfill [%d,%d): %v\n", start, end, r.err)
			}
			continue
		}
		if r.amount != nil {
			amount = r.amount
		}
		if r.cost != nil {
			cost = r.cost
		}
	}
	if amount == nil || cost == nil {
		return
	}
	a.trend.ReplaceRange(mergeRange(amount, cost, start, end), start, end)
}

// mergeRange 把 [start, end) 的 amount + cost 合并成按小时的点，
// 并补齐范围内缺失的小时（保证覆盖判定稳定）。
func mergeRange(amount *deepseek.UsageAmountData, cost *deepseek.CostData, start, end int64) []panel.TrendPoint {
	byTime := make(map[int64]*panel.TrendPoint)
	for _, series := range amount.Series {
		for _, bucket := range series.Buckets {
			t := int64(bucket.Time)
			point := byTime[t]
			if point == nil {
				point = &panel.TrendPoint{Time: t}
				byTime[t] = point
			}
			point.Tokens += int64(intOrZero(bucket.Usage.ResponseToken)) +
				int64(intOrZero(bucket.Usage.PromptCacheHitToken)) +
				int64(intOrZero(bucket.Usage.PromptCacheMissToken))
		}
	}
	if cost.Data != nil {
		for _, currencySeries := range *cost.Data {
			isUSD := currencySeries.Currency == "USD"
			for _, series := range currencySeries.Series {
				for _, bucket := range series.Buckets {
					t := int64(bucket.Time)
					point := byTime[t]
					if point == nil {
						point = &panel.TrendPoint{Time: t}
						byTime[t] = point
					}
					value := panel.ParseDecimal(bucket.Cost)
					if isUSD {
						point.CostUSD += value
					} else {
						point.CostCNY += value
					}
				}
			}
		}
	}
	for t := start; t < end; t += 3600 {
		if byTime[t] == nil {
			byTime[t] = &panel.TrendPoint{Time: t}
		}
	}
	out := make([]panel.TrendPoint, 0, len(byTime))
	for _, p := range byTime {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out
}

// combinedTrend 图表数据 = 本地小时缓存 + 未缓存日期的远程日粒度点。
func (a *App) combinedTrend(window panel.StatsWindow, fetched []panel.TrendPoint) []panel.TrendPoint {
	var cached []panel.TrendPoint
	for _, p := range a.trend.Points() {
		if window.Contains(p.Time) {
			cached = append(cached, p)
		}
	}
	merged := make(map[int64]panel.TrendPoint)
	for _, p := range cached {
		merged[p.Time] = p
	}
	coveredDays := make(map[int64]bool)
	for _, p := range cached {
		coveredDays[(p.Time/86400)*86400] = true
	}
	for _, p := range fetched {
		if !coveredDays[(p.Time/86400)*86400] {
			merged[p.Time] = p
		}
	}
	out := make([]panel.TrendPoint, 0, len(merged))
	for _, p := range merged {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out
}

// ---- 序列化 ----

func (a *App) reportJSON(report panel.UsageReport, currency string) ReportJSON {
	out := ReportJSON{}
	for _, key := range report.Keys {
		rate := key.CacheHitRate()
		out.Keys = append(out.Keys, KeyRow{
			Name:                  key.Name,
			Requests:              key.Requests,
			TotalTokens:           key.TotalTokens(),
			CacheHitRate:          rate,
			Cost:                  key.Cost(currency),
			CostCNY:               key.CostCNY,
			CostUSD:               key.CostUSD,
			PromptCacheHitTokens:  key.PromptCacheHitTokens,
			PromptCacheMissTokens: key.PromptCacheMissTokens,
			ResponseTokens:        key.ResponseTokens,
		})
		out.HitTokens += key.PromptCacheHitTokens
		out.MissTokens += key.PromptCacheMissTokens
		out.TotalRequests += key.Requests
	}
	for _, model := range report.Models {
		out.Models = append(out.Models, ModelRow{
			Name:   model.Name,
			Tokens: model.Tokens,
			Cost:   model.Cost(currency),
		})
		out.TotalTokens += model.Tokens
		out.TotalCost += model.Cost(currency)
	}
	for _, p := range report.Trend {
		out.Trend = append(out.Trend, TrendPointJSON{
			Time:    p.Time,
			Tokens:  p.Tokens,
			CostCNY: p.CostCNY,
			CostUSD: p.CostUSD,
		})
	}
	return out
}

func (a *App) settingsJSON(settings panel.Settings) SettingsJSON {
	return SettingsJSON{
		RefreshIntervalMinutes: settings.RefreshIntervalMinutes,
		Period:                 settings.Period,
		DisplayCurrency:        settings.DisplayCurrency,
		UseMockData:            settings.UseMockData,
		Budget:                 settings.Budget,
		HeatmapMetric:          settings.HeatmapMetric,
		TrayDisplay:            settings.TrayDisplay,
		HasToken:               a.token() != "",
		LaunchAtLogin:          a.autostart.IsEnabled(),
	}
}

// ---- 托盘文案 ----

// todayTotals 汇总今天（本地 0 点起）的趋势点：Token 与费用（按显示币种）。
func todayTotals(snap *Snapshot, currency string) (int64, float64) {
	now := time.Now()
	y, m, d := now.Date()
	todayStart := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).Unix()
	var tokens int64
	var cost float64
	for _, p := range snap.Report.Trend {
		if p.Time >= todayStart {
			tokens += p.Tokens
			if currency == "USD" {
				cost += p.CostUSD
			} else {
				cost += p.CostCNY
			}
		}
	}
	return tokens, cost
}

// trayText 生成托盘标题与提示：
// 标题显示「今日消耗 Token/费用」；无当日数据时回退到余额。
func (a *App) trayText(snap *Snapshot, settings panel.Settings) (string, string) {
	currency := settings.DisplayCurrency
	todayTokens, todayCost := todayTotals(snap, currency)
	hasToday := todayTokens > 0 || todayCost > 0

	title := "🐋"
	switch panel.TrayDisplay(settings.TrayDisplay) {
	case panel.TrayCost:
		if hasToday {
			title = "🐋 今日 " + panel.FormatMoney(todayCost, currency)
		} else if snap.Summary != nil {
			if wallet := pickWallet(snap.Summary, settings.DisplayCurrency); wallet != nil {
				title = "🐋 " + panel.FormatMoney(panel.ParseDecimal(wallet.Balance), wallet.Currency)
			}
		}
	case panel.TrayTokens:
		if hasToday {
			title = "🐋 今日 " + panel.FormatTokens(todayTokens)
		} else if snap.Summary != nil {
			if wallet := pickWallet(snap.Summary, settings.DisplayCurrency); wallet != nil {
				title = "🐋 " + panel.FormatMoney(panel.ParseDecimal(wallet.Balance), wallet.Currency)
			}
		}
	case panel.TrayBalance:
		if snap.Summary != nil {
			if wallet := pickWallet(snap.Summary, settings.DisplayCurrency); wallet != nil {
				title = "🐋 " + panel.FormatMoney(panel.ParseDecimal(wallet.Balance), wallet.Currency)
			}
		}
	case panel.TrayNone:
		title = "🐋"
	default: // TrayBoth
		if hasToday {
			title = "🐋 今日 " + panel.FormatMoney(todayCost, currency) + " · " + panel.FormatTokens(todayTokens)
		} else if snap.Summary != nil {
			if wallet := pickWallet(snap.Summary, settings.DisplayCurrency); wallet != nil {
				title = "🐋 " + panel.FormatMoney(panel.ParseDecimal(wallet.Balance), wallet.Currency)
			}
		}
	}
	if snap.ErrorMessage != "" && snap.Summary == nil {
		title = "⚠️"
	}

	var parts []string
	parts = append(parts, "DeepSeek 用量面板")
	if hasToday {
		parts = append(parts, fmt.Sprintf("今日：%s · %s Token · %s 请求",
			panel.FormatMoney(todayCost, currency), panel.FormatTokens(todayTokens),
			panel.FormatTokens(snap.Report.TotalRequests)))
	}
	if snap.Summary != nil {
		wallet := pickWallet(snap.Summary, settings.DisplayCurrency)
		if wallet != nil {
			sub := "余额：" + panel.FormatMoney(panel.ParseDecimal(wallet.Balance), wallet.Currency)
			if spent := firstTotal(snap.Summary, wallet.Currency); spent != nil {
				sub += " · 已消费 " + panel.FormatMoney(panel.ParseDecimal(spent.Amount), spent.Currency)
			}
			parts = append(parts, sub)
		}
	}
	if snap.LastUpdated != nil {
		parts = append(parts, "最后更新 "+time.Unix(*snap.LastUpdated, 0).Format("15:04"))
	} else if snap.ErrorMessage == "" {
		parts = append(parts, "加载中…")
	}
	if snap.ErrorMessage != "" && snap.Summary != nil {
		parts = append(parts, snap.ErrorMessage)
	}
	return title, strings.Join(parts, "\n")
}

func pickWallet(summary *deepseek.UserSummary, currency string) *deepseek.Wallet {
	for i := range summary.NormalWallets {
		if summary.NormalWallets[i].Currency == currency {
			return &summary.NormalWallets[i]
		}
	}
	if len(summary.NormalWallets) > 0 {
		return &summary.NormalWallets[0]
	}
	return nil
}

func firstTotal(summary *deepseek.UserSummary, currency string) *deepseek.CostTotal {
	for i := range summary.TotalCosts {
		if summary.TotalCosts[i].Currency == currency {
			return &summary.TotalCosts[i]
		}
	}
	return nil
}

// ---- 绑定方法（前端调用） ----

// GetSnapshot 返回当前快照。
func (a *App) GetSnapshot() Snapshot {
	return a.currentSnapshot()
}

// RefreshNow 立即刷新。
func (a *App) RefreshNow() {
	go a.refresh()
}

// SetPeriod 切换统计周期并刷新。
func (a *App) SetPeriod(period string) {
	settings := a.settings.Get()
	settings.Period = string(panel.ParsePeriod(period))
	a.settings.Save(settings)
	go a.refresh()
}

// SaveSettings 保存设置并刷新。返回实际生效的设置与错误信息。
func (a *App) SaveSettings(s SettingsJSON) (SettingsJSON, error) {
	settings := panel.Settings{
		RefreshIntervalMinutes: s.RefreshIntervalMinutes,
		Period:                 s.Period,
		DisplayCurrency:        s.DisplayCurrency,
		UseMockData:            s.UseMockData,
		Budget:                 s.Budget,
		HeatmapMetric:          s.HeatmapMetric,
		TrayDisplay:            s.TrayDisplay,
	}
	settings.Normalize()
	a.settings.Save(settings)

	var err error
	if s.LaunchAtLogin {
		err = a.autostart.Enable()
	} else {
		err = a.autostart.Disable()
	}
	go a.refresh()
	return a.settingsJSON(a.settings.Get()), err
}

// SaveToken 保存 Bearer Token。
func (a *App) SaveToken(token string) error {
	return a.tokens.Save(token)
}

// ReportError 前端 JS 错误上报（调试用）。
func (a *App) ReportError(msg string) {
	fmt.Fprintln(os.Stderr, "JS-ERROR:", msg)
}

// OpenUsagePage 在浏览器中打开平台用量页。
func (a *App) OpenUsagePage() {
	url := "https://platform.deepseek.com/usage"
	if runtime.GOOS == "darwin" {
		_ = exec.Command("open", url).Start()
		return
	}
	_ = exec.Command("xdg-open", url).Start()
}

// Quit 退出应用。
func (a *App) Quit() {
	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	}
}

// ---- 内部工具 ----

func (a *App) token() string {
	if t := os.Getenv("DEEPSEEK_PANEL_TEST_TOKEN"); t != "" {
		return t
	}
	return a.tokens.Load()
}

func (a *App) currentSnapshot() Snapshot {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.snapshot
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func intOrZero(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
