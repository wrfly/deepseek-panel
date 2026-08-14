// Package panel 提供统计周期、聚合、持久化与模拟数据等核心逻辑。
// 与 macOS 版 Sources/DeepSeekPanel/ 下的 Swift 实现一一对应。
package panel

import "time"

// StatsPeriod 统计周期。
type StatsPeriod string

const (
	PeriodToday     StatsPeriod = "today"
	PeriodLast24h   StatsPeriod = "last24h"
	PeriodLast7d    StatsPeriod = "last7d"
	PeriodThisMonth StatsPeriod = "thisMonth"
)

// AllPeriods 按展示顺序排列的全部周期。
var AllPeriods = []StatsPeriod{PeriodToday, PeriodLast24h, PeriodLast7d, PeriodThisMonth}

// Title 周期的中文标题。
func (p StatsPeriod) Title() string {
	switch p {
	case PeriodToday:
		return "今天"
	case PeriodLast24h:
		return "最近 24 小时"
	case PeriodLast7d:
		return "最近 7 天"
	case PeriodThisMonth:
		return "本月"
	}
	return string(p)
}

// ParsePeriod 解析字符串为周期，非法值回退到 today。
func ParsePeriod(raw string) StatsPeriod {
	switch StatsPeriod(raw) {
	case PeriodToday, PeriodLast24h, PeriodLast7d, PeriodThisMonth:
		return StatsPeriod(raw)
	}
	return PeriodToday
}

// StatsWindow 一次统计的过滤窗口与请求窗口。
// 与 Swift StatsWindow 一致：
//   - filterStart/filterEnd：小时对齐，用于过滤桶数据；
//   - requestStart/requestEnd：向接口请求的区间（按天对齐，且 requestEnd 为次日 0 点）。
type StatsWindow struct {
	FilterStart  int64
	FilterEnd    int64
	RequestStart int64
	RequestEnd   int64
}

// Contains 判断时间戳是否落在过滤窗口内。
func (w StatsWindow) Contains(time int64) bool {
	return time >= w.FilterStart && time < w.FilterEnd
}

// Window 计算某周期在 now 时刻的统计窗口。
func (p StatsPeriod) Window(now time.Time) StatsWindow {
	end := now.Unix()
	start := end - 86400

	switch p {
	case PeriodToday:
		y, m, d := now.Date()
		start = time.Date(y, m, d, 0, 0, 0, 0, now.Location()).Unix()
	case PeriodLast24h:
		start = end - 86400
	case PeriodLast7d:
		start = end - 7*86400
	case PeriodThisMonth:
		y, m, _ := now.Date()
		start = time.Date(y, m, 1, 0, 0, 0, 0, now.Location()).Unix()
	}

	hour := int64(3600)
	filterStart := (start / hour) * hour
	filterEnd := ((end + hour - 1) / hour) * hour

	// requestStart = filterStart 所在日期的本地 0 点
	fs := time.Unix(filterStart, 0).In(now.Location())
	y, m, d := fs.Date()
	requestStart := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).Unix()

	// requestEnd = now 所在日期的次日 0 点
	y2, m2, d2 := now.Date()
	requestEnd := time.Date(y2, m2, d2, 0, 0, 0, 0, now.Location()).Unix() + 86400

	return StatsWindow{
		FilterStart:  filterStart,
		FilterEnd:    filterEnd,
		RequestStart: requestStart,
		RequestEnd:   requestEnd,
	}
}

// LocalTZOffset 返回当前时区相对 UTC 的偏移秒数（接口 tz 参数）。
func LocalTZOffset(now time.Time) int {
	_, offset := now.Zone()
	return offset
}
