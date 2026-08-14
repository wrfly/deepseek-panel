package panel

import (
	"time"
)

// HeatmapCell 热力图单个格子（某一天）的聚合数据。
type HeatmapCell struct {
	Tokens int64   `json:"tokens"`
	Cost   float64 `json:"cost"`
}

// Heatmap 尺寸常量与 Swift 一致。
const (
	HeatmapCols = 24
	HeatmapRows = 7
)

// HeatmapStartMonday 返回最近 24 周的第一天（最早那一周的周一 0 点）。
func HeatmapStartMonday(now time.Time) time.Time {
	weekday := int(now.Weekday()) // 0=周日 … 6=周六
	daysSinceMonday := (weekday + 6) % 7
	thisMonday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).
		AddDate(0, 0, -daysSinceMonday)
	return thisMonday.AddDate(0, 0, -7*(HeatmapCols-1))
}

// BuildHeatmap 从按小时趋势点聚合最近 24 周 × 7 天热力图。
// 返回 [星期 0..6][周 0..23]（0=周一 … 6=周日）与起始周一 0 点时间戳。
func BuildHeatmap(points []TrendPoint, currency string, now time.Time) ([][]HeatmapCell, int64) {
	byDay := make(map[int64]HeatmapCell)
	for _, p := range points {
		t := time.Unix(p.Time, 0).In(now.Location())
		dayStart := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, now.Location()).Unix()
		cell := byDay[dayStart]
		cell.Tokens += p.Tokens
		cell.Cost += p.Cost(currency)
		byDay[dayStart] = cell
	}

	firstMonday := HeatmapStartMonday(now)
	rows := make([][]HeatmapCell, HeatmapRows)
	for row := 0; row < HeatmapRows; row++ {
		rows[row] = make([]HeatmapCell, HeatmapCols)
		for col := 0; col < HeatmapCols; col++ {
			day := firstMonday.AddDate(0, 0, col*7+row)
			rows[row][col] = byDay[day.Unix()]
		}
	}
	return rows, firstMonday.Unix()
}

// MockHeatmap 生成 mock 模式的 24 周热力图（纯内存，绝不落盘）。
func MockHeatmap(m MockData, tz int, currency string, now time.Time) [][]HeatmapCell {
	firstMonday := HeatmapStartMonday(now)
	rows := make([][]HeatmapCell, HeatmapRows)
	for row := 0; row < HeatmapRows; row++ {
		rows[row] = make([]HeatmapCell, HeatmapCols)
		for col := 0; col < HeatmapCols; col++ {
			day := firstMonday.AddDate(0, 0, col*7+row)
			start := day.Unix()
			window := StatsWindow{FilterStart: start, FilterEnd: start + 86400, RequestStart: start, RequestEnd: start + 86400}
			_, _, amount, cost := m.Fetch(window, tz)

			var tokens int64
			for _, series := range amount.Series {
				for _, bucket := range series.Buckets {
					if int64(bucket.Time) >= start && int64(bucket.Time) < start+86400 {
						tokens += int64(intOrZero(bucket.Usage.ResponseToken)) +
							int64(intOrZero(bucket.Usage.PromptCacheHitToken)) +
							int64(intOrZero(bucket.Usage.PromptCacheMissToken))
					}
				}
			}
			var costValue float64
			if cost.Data != nil {
				for _, currencySeries := range *cost.Data {
					if currencySeries.Currency != currency {
						continue
					}
					for _, series := range currencySeries.Series {
						for _, bucket := range series.Buckets {
							if int64(bucket.Time) >= start && int64(bucket.Time) < start+86400 {
								costValue += ParseDecimal(bucket.Cost)
							}
						}
					}
				}
			}
			rows[row][col] = HeatmapCell{Tokens: tokens, Cost: costValue}
		}
	}
	return rows
}
