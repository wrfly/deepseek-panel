package panel

import (
	"fmt"
	"os"
	"time"

	"github.com/wrfly/deepseek-panel/internal/deepseek"
)

// timeNow 可注入的当前时间（测试用）。
var timeNow = func() time.Time { return time.Now() }

// Dump 无界面自测：拉取并打印余额/用量，与 macOS 版 --dump 一致。
func Dump(client *deepseek.Client, m MockData, settings Settings, token string) string {
	useMock := os.Getenv("DEEPSEEK_PANEL_MOCK") == "1" || settings.UseMockData
	period := ParsePeriod(settings.Period)
	now := timeNow()
	window := period.Window(now)
	tz := LocalTZOffset(now)

	var summary *deepseek.UserSummary
	var keys []deepseek.APIKeyInfo
	var amount *deepseek.UsageAmountData
	var cost *deepseek.CostData
	var err error

	if useMock {
		summary, keys, amount, cost = m.Fetch(window, tz)
	} else {
		if token == "" {
			fmt.Println("DUMP_ERROR: 尚未配置 Token，请先在设置中填写或设置 DEEPSEEK_PANEL_TEST_TOKEN 环境变量")
			return "DUMP_ERROR"
		}
		if summary, err = client.FetchSummary(); err != nil {
			fmt.Println("DUMP_ERROR:", err)
			return "DUMP_ERROR"
		}
		if keys, err = client.FetchKeys(); err != nil {
			fmt.Println("DUMP_ERROR:", err)
			return "DUMP_ERROR"
		}
		if amount, err = client.FetchAmount(window.RequestStart, window.RequestEnd, tz); err != nil {
			fmt.Println("DUMP_ERROR:", err)
			return "DUMP_ERROR"
		}
		if cost, err = client.FetchCost(window.RequestStart, window.RequestEnd, tz); err != nil {
			fmt.Println("DUMP_ERROR:", err)
			return "DUMP_ERROR"
		}
	}

	report := Build(keys, *amount, *cost, window, settings.DisplayCurrency)

	fmt.Println("=== 余额 ===")
	for _, wallet := range summary.NormalWallets {
		fmt.Printf("充值 %s: %s\n", wallet.Currency, wallet.Balance)
	}
	for _, wallet := range summary.BonusWallets {
		fmt.Printf("赠送 %s: %s\n", wallet.Currency, wallet.Balance)
	}
	for _, total := range summary.TotalCosts {
		fmt.Printf("累计消耗 %s: %s\n", total.Currency, total.Amount)
	}
	fmt.Println("=== API Keys ===")
	for _, key := range keys {
		fmt.Printf("- %s\n", key.Name)
	}
	fmt.Println("=== 用量（" + period.Title() + "）===")
	for _, usage := range report.Keys {
		inputTotal := usage.PromptCacheHitTokens + usage.PromptCacheMissTokens
		fmt.Printf("- %s: 请求数=%d 输入总量=%s 命中率=%s 输出=%d 费用CNY=%.2f 费用USD=%.2f\n",
			usage.Name, usage.Requests, FormatTokens(inputTotal), FormatRate(usage.CacheHitRate()),
			usage.ResponseTokens, usage.CostCNY, usage.CostUSD)
	}
	fmt.Println("=== 模型 ===")
	for _, model := range report.Models {
		fmt.Printf("- %s: tokens=%d cny=%.2f usd=%.2f\n", model.Name, model.Tokens, model.CostCNY, model.CostUSD)
	}
	fmt.Println("=== 趋势（", len(report.Trend), "个点）===")
	for _, point := range report.Trend {
		fmt.Printf("- %d: tokens=%d cny=%.2f usd=%.2f\n", point.Time, point.Tokens, point.CostCNY, point.CostUSD)
	}
	fmt.Println("DUMP_OK")
	return "DUMP_OK"
}
