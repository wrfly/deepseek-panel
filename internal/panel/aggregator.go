package panel

import (
	"sort"
	"strings"

	"github.com/wrfly/deepseek-panel/internal/deepseek"
)

// KeyUsage 单个 Key 在统计周期内的聚合用量。
type KeyUsage struct {
	Name                  string
	TrackingID            string
	Requests              int64
	ResponseTokens        int64
	PromptCacheHitTokens  int64
	PromptCacheMissTokens int64
	CostCNY               float64
	CostUSD               float64
}

// TotalTokens 输出 + 命中 + 未命中。
func (k *KeyUsage) TotalTokens() int64 {
	return k.ResponseTokens + k.PromptCacheHitTokens + k.PromptCacheMissTokens
}

// CacheHitRate 缓存命中率；无输入时不返回数值。
func (k *KeyUsage) CacheHitRate() *float64 {
	denominator := k.PromptCacheHitTokens + k.PromptCacheMissTokens
	if denominator <= 0 {
		return nil
	}
	r := float64(k.PromptCacheHitTokens) / float64(denominator)
	return &r
}

// Cost 按币种返回费用。
func (k *KeyUsage) Cost(currency string) float64 {
	if currency == "USD" {
		return k.CostUSD
	}
	return k.CostCNY
}

// TrendPoint 单个时间点上的聚合用量（跨所有 Key）。
// JSON 结构用于 TrendStore 持久化，与 Swift TrendPoint Codable 一致。
type TrendPoint struct {
	Time    int64   `json:"time"`
	Tokens  int64   `json:"tokens"`
	CostCNY float64 `json:"costCNY"`
	CostUSD float64 `json:"costUSD"`
}

// Cost 按币种返回费用。
func (t *TrendPoint) Cost(currency string) float64 {
	if currency == "USD" {
		return t.CostUSD
	}
	return t.CostCNY
}

// ModelUsage 单个模型的聚合用量。
type ModelUsage struct {
	Name    string
	Tokens  int64
	CostCNY float64
	CostUSD float64
}

// Cost 按币种返回费用。
func (m *ModelUsage) Cost(currency string) float64 {
	if currency == "USD" {
		return m.CostUSD
	}
	return m.CostCNY
}

// UsageReport 一次聚合的完整结果：各 Key 排行 + 模型拆分 + 趋势。
type UsageReport struct {
	Keys   []*KeyUsage
	Models []*ModelUsage
	Trend  []TrendPoint
}

// Build 把 amount + cost 原始数据聚合为 UsageReport。
// 与 Swift UsageAggregator.build 行为一致。
func Build(
	keys []deepseek.APIKeyInfo,
	amount deepseek.UsageAmountData,
	cost deepseek.CostData,
	window StatsWindow,
	currency string,
) UsageReport {
	byName := make(map[string]*KeyUsage)
	for _, key := range keys {
		byName[key.Name] = &KeyUsage{Name: key.Name, TrackingID: key.TrackingID}
	}
	modelByName := make(map[string]*ModelUsage)
	trendByTime := make(map[int64]*TrendPoint)

	for _, series := range amount.Series {
		usage := byName[series.APIKey.Name]
		if usage == nil {
			usage = &KeyUsage{Name: series.APIKey.Name, TrackingID: series.APIKey.TrackingID}
		}
		for _, bucket := range series.Buckets {
			t := int64(bucket.Time)
			if !window.Contains(t) {
				continue
			}
			usage.Requests += int64(intOrZero(bucket.Usage.Request))
			usage.ResponseTokens += int64(intOrZero(bucket.Usage.ResponseToken))
			usage.PromptCacheHitTokens += int64(intOrZero(bucket.Usage.PromptCacheHitToken))
			usage.PromptCacheMissTokens += int64(intOrZero(bucket.Usage.PromptCacheMissToken))

			bucketTokens := int64(intOrZero(bucket.Usage.ResponseToken)) +
				int64(intOrZero(bucket.Usage.PromptCacheHitToken)) +
				int64(intOrZero(bucket.Usage.PromptCacheMissToken))

			point := trendByTime[t]
			if point == nil {
				point = &TrendPoint{Time: t}
				trendByTime[t] = point
			}
			point.Tokens += bucketTokens

			model := modelByName[series.Model]
			if model == nil {
				model = &ModelUsage{Name: series.Model}
				modelByName[series.Model] = model
			}
			model.Tokens += bucketTokens
		}
		byName[series.APIKey.Name] = usage
	}

	if cost.Data != nil {
		for _, currencySeries := range *cost.Data {
			isUSD := currencySeries.Currency == "USD"
			for _, series := range currencySeries.Series {
				usage := byName[series.APIKey.Name]
				if usage == nil {
					usage = &KeyUsage{Name: series.APIKey.Name, TrackingID: series.APIKey.TrackingID}
				}
				for _, bucket := range series.Buckets {
					t := int64(bucket.Time)
					if !window.Contains(t) {
						continue
					}
					value := ParseDecimal(bucket.Cost)
					if isUSD {
						usage.CostUSD += value
					} else {
						usage.CostCNY += value
					}

					point := trendByTime[t]
					if point == nil {
						point = &TrendPoint{Time: t}
						trendByTime[t] = point
					}
					if isUSD {
						point.CostUSD += value
					} else {
						point.CostCNY += value
					}

					model := modelByName[series.Model]
					if model == nil {
						model = &ModelUsage{Name: series.Model}
						modelByName[series.Model] = model
					}
					if isUSD {
						model.CostUSD += value
					} else {
						model.CostCNY += value
					}
				}
				byName[series.APIKey.Name] = usage
			}
		}
	}

	var keysOut []*KeyUsage
	for _, key := range byName {
		if key.Requests > 0 || key.TotalTokens() > 0 || key.CostCNY > 0 || key.CostUSD > 0 {
			keysOut = append(keysOut, key)
		}
	}
	sort.Slice(keysOut, func(i, j int) bool {
		li, lj := keysOut[i].Cost(currency), keysOut[j].Cost(currency)
		if li != lj {
			return li > lj
		}
		return strings.ToLower(keysOut[i].Name) < strings.ToLower(keysOut[j].Name)
	})

	var modelsOut []*ModelUsage
	for _, model := range modelByName {
		if model.Tokens > 0 || model.CostCNY > 0 || model.CostUSD > 0 {
			modelsOut = append(modelsOut, model)
		}
	}
	sort.Slice(modelsOut, func(i, j int) bool {
		if modelsOut[i].Tokens != modelsOut[j].Tokens {
			return modelsOut[i].Tokens > modelsOut[j].Tokens
		}
		return strings.ToLower(modelsOut[i].Name) < strings.ToLower(modelsOut[j].Name)
	})

	var trendOut []TrendPoint
	for _, point := range trendByTime {
		trendOut = append(trendOut, *point)
	}
	sort.Slice(trendOut, func(i, j int) bool { return trendOut[i].Time < trendOut[j].Time })

	return UsageReport{Keys: keysOut, Models: modelsOut, Trend: trendOut}
}

func intOrZero(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
