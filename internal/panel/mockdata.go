package panel

import (
	"fmt"

	"github.com/wrfly/deepseek-panel/internal/deepseek"
)

// MockData 本地模拟数据：结构与真实接口一致，按小时生成、按天变化，
// 用于离线测试，避免被平台 WAF 限流干扰。
// 与 Swift MockData 对应。
type MockData struct{}

// MockFetch 返回模拟的 summary / keys / amount / cost。
func (MockData) Fetch(window StatsWindow, tz int) (*deepseek.UserSummary, []deepseek.APIKeyInfo, *deepseek.UsageAmountData, *deepseek.CostData) {
	keys := []deepseek.APIKeyInfo{
		{CreatedAt: intPtr(1_700_000_000), TrackingID: "mock-claude", SensitiveID: "sk-mock-1***", Name: "claude"},
		{CreatedAt: intPtr(1_700_000_000), TrackingID: "mock-codex", SensitiveID: "sk-mock-2***", Name: "codex"},
		{CreatedAt: intPtr(1_700_000_000), TrackingID: "mock-cursor", SensitiveID: "sk-mock-3***", Name: "cursor"},
		{CreatedAt: intPtr(1_700_000_000), TrackingID: "mock-wechat", SensitiveID: "sk-mock-4***", Name: "wechat filter"},
	}
	models := []string{
		"deepseek-chat & deepseek-reasoner",
		"deepseek-v4-flash",
		"deepseek-v4-pro",
	}

	var amountSeries []deepseek.AmountSeries
	var cnySeries, usdSeries []deepseek.CostSeries

	for _, key := range keys {
		var keyModels []string
		switch key.Name {
		case "claude":
			keyModels = []string{"deepseek-v4-flash", "deepseek-v4-pro"}
		case "codex":
			keyModels = []string{"deepseek-chat & deepseek-reasoner", "deepseek-v4-pro"}
		case "wechat filter":
			keyModels = []string{"deepseek-v4-flash"}
		default:
			continue // cursor 不活跃
		}

		for _, model := range keyModels {
			var amountBuckets []deepseek.AmountBucket
			var cnyBuckets, usdBuckets []deepseek.CostBucket
			for t := window.RequestStart; t < window.RequestEnd; t += 3600 {
				usage := mockUsage(t, key.Name, model)
				amountBuckets = append(amountBuckets, deepseek.AmountBucket{Time: int(t), Usage: usage})
				usd := mockCostUSD(usage, model)
				cnyBuckets = append(cnyBuckets, deepseek.CostBucket{Time: int(t), Cost: fmt.Sprintf("%.10f", usd*7.2)})
				usdBuckets = append(usdBuckets, deepseek.CostBucket{Time: int(t), Cost: fmt.Sprintf("%.10f", usd)})
			}

			seriesKey := deepseek.SeriesKey{
				TrackingID:  key.TrackingID,
				Name:        key.Name,
				SensitiveID: key.SensitiveID,
				Valid:       boolPtr(true),
			}
			amountSeries = append(amountSeries, deepseek.AmountSeries{APIKey: seriesKey, Model: model, Buckets: amountBuckets})
			cnySeries = append(cnySeries, deepseek.CostSeries{APIKey: seriesKey, Model: model, Buckets: cnyBuckets})
			usdSeries = append(usdSeries, deepseek.CostSeries{APIKey: seriesKey, Model: model, Buckets: usdBuckets})
		}
	}

	amount := &deepseek.UsageAmountData{
		Start:  int(window.RequestStart),
		End:    int(window.RequestEnd),
		Bucket: 3600,
		Models: &models,
		Series: amountSeries,
	}
	cost := &deepseek.CostData{
		Start:  int(window.RequestStart),
		End:    int(window.RequestEnd),
		Bucket: 3600,
		Models: &models,
		Data: &[]deepseek.CurrencyCostSeries{
			{Currency: "CNY", Series: cnySeries},
			{Currency: "USD", Series: usdSeries},
		},
	}
	summary := &deepseek.UserSummary{
		NormalWallets: []deepseek.Wallet{
			{Currency: "USD", Balance: "8.4200000000", TokenEstimation: strPtr("0")},
			{Currency: "CNY", Balance: "3.1400000000", TokenEstimation: strPtr("0")},
		},
		BonusWallets: []deepseek.Wallet{
			{Currency: "USD", Balance: "0", TokenEstimation: strPtr("0")},
		},
		TotalCosts: []deepseek.CostTotal{
			{Currency: "USD", Amount: "0.8800000000"},
			{Currency: "CNY", Amount: "1.2300000000"},
		},
	}
	return summary, keys, amount, cost
}

func mockUsage(time int64, keyName, model string) deepseek.TokenUsage {
	hour := (time % 86400) / 3600
	busy := 0.2
	if hour >= 9 && hour <= 22 {
		busy = 1.0
	}
	keyFactor := 1.0
	if keyName == "wechat filter" {
		keyFactor = 0.04
	}
	modelFactor := 1.0
	if model == "deepseek-v4-pro" {
		modelFactor = 2.0
	}
	base := int(2_000_000 * busy * keyFactor * modelFactor)
	salt := fnv1a(keyName)

	hit := mockRand(time, int64(salt+1), max(base, 1))
	miss := mockRand(time, int64(salt+2), max(base/8, 500))
	response := mockRand(time, int64(salt+3), max(base/20, 100))
	requests := mockRand(time, int64(salt+4), max(base/6000, 1))

	return deepseek.TokenUsage{
		Request:              &requests,
		ResponseToken:        &response,
		PromptCacheHitToken:  &hit,
		PromptCacheMissToken: &miss,
	}
}

func mockCostUSD(usage deepseek.TokenUsage, model string) float64 {
	hit := float64(intOrZero(usage.PromptCacheHitToken))
	miss := float64(intOrZero(usage.PromptCacheMissToken))
	output := float64(intOrZero(usage.ResponseToken))
	prices := struct{ hit, miss, output float64 }{0.02, 1.0, 2.0}
	if model == "deepseek-v4-pro" {
		prices = struct{ hit, miss, output float64 }{0.025, 3.0, 6.0}
	}
	return (hit*prices.hit + miss*prices.miss + output*prices.output) / 1_000_000
}

// mockRand 确定性伪随机，保证同一小时的值稳定（等价 Swift MockData.rand）。
func mockRand(time, salt int64, scale int) int {
	x := uint64(time) * 0x9E3779B97F4A7C15
	x += uint64(salt)
	x ^= x >> 30
	x *= 0xBF58476D1CE4E5B9
	x ^= x >> 27
	x *= 0x94D049BB133111EB
	x ^= x >> 31
	if scale <= 1 {
		return 0
	}
	return int(x % uint64(scale))
}

func fnv1a(s string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}

func intPtr(v int) *int       { return &v }
func strPtr(s string) *string { return &s }
func boolPtr(b bool) *bool    { return &b }
