package panel

import "fmt"

// FormatMoney 与 Swift formatMoney 一致：USD 用 $，其余用 ¥；
// 极小费用（<0.01）保留 4 位小数，常规 2 位。
func FormatMoney(value float64, currency string) string {
	symbol := "$"
	if currency != "USD" {
		symbol = "¥"
	}
	decimals := 2
	if value != 0 && value > -0.01 && value < 0.01 {
		decimals = 4
	}
	return fmt.Sprintf("%s%.*f", symbol, decimals, value)
}

// FormatTokens 与 Swift formatTokens 一致：M / k 缩写。
func FormatTokens(count int64) string {
	if count >= 1_000_000 {
		return fmt.Sprintf("%.2fM", float64(count)/1_000_000)
	}
	if count >= 1_000 {
		return fmt.Sprintf("%.0fk", float64(count)/1_000)
	}
	return fmt.Sprintf("%d", count)
}

// FormatRate 命中率百分比，nil 显示 —。
func FormatRate(rate *float64) string {
	if rate == nil {
		return "—"
	}
	return fmt.Sprintf("%.1f%%", *rate*100)
}

// ParseDecimal 解析字符串金额。
func ParseDecimal(s string) float64 {
	var v float64
	_, _ = fmt.Sscanf(s, "%f", &v)
	return v
}
