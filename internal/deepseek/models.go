// Package deepseek 实现了 DeepSeek 平台网页会话 API 的客户端与数据模型。
// 与 macOS 版 Sources/DeepSeekPanel/Models.swift 对应。
package deepseek

// Wallet 钱包余额（平台返回字符串金额）。
type Wallet struct {
	Currency        string  `json:"currency"`
	Balance         string  `json:"balance"`
	TokenEstimation *string `json:"tokenEstimation"`
}

// CostTotal 累计消耗。
type CostTotal struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
}

// UserSummary get_user_summary 的 bizData。
type UserSummary struct {
	NormalWallets []Wallet    `json:"normalWallets"`
	BonusWallets  []Wallet    `json:"bonusWallets"`
	TotalCosts    []CostTotal `json:"totalCosts"`
}

// APIKeyInfo 单个 API Key 信息。
type APIKeyInfo struct {
	CreatedAt   *int   `json:"createdAt"`
	LastUse     *int   `json:"lastUse"`
	TrackingID  string `json:"trackingId"`
	SensitiveID string `json:"sensitiveId"`
	Name        string `json:"name"`
}

// APIKeyList get_api_keys 的 bizData。
type APIKeyList struct {
	APIKeys []APIKeyInfo `json:"apiKeys"`
}

// SeriesKey 用量序列对应的 Key。
type SeriesKey struct {
	TrackingID  string `json:"trackingId"`
	Name        string `json:"name"`
	SensitiveID string `json:"sensitiveId"`
	Valid       *bool  `json:"valid"`
}

// TokenUsage 单个桶的 Token 用量。
// 注意：平台 JSON 中请求数键为大写 REQUEST，其余为 camelCase。
type TokenUsage struct {
	Request              *int `json:"REQUEST"`
	ResponseToken        *int `json:"responseToken"`
	PromptCacheHitToken  *int `json:"promptCacheHitToken"`
	PromptCacheMissToken *int `json:"promptCacheMissToken"`
}

// AmountBucket 按小时聚合的 Token 用量桶。
type AmountBucket struct {
	Time  int        `json:"time"`
	Usage TokenUsage `json:"usage"`
}

// AmountSeries 单个 Key+模型 的 Token 用量序列。
type AmountSeries struct {
	APIKey  SeriesKey      `json:"apiKey"`
	Model   string         `json:"model"`
	Buckets []AmountBucket `json:"buckets"`
}

// UsageAmountData by_api_key/amount 的 bizData。
type UsageAmountData struct {
	Start  int            `json:"start"`
	End    int            `json:"end"`
	Bucket int            `json:"bucket"`
	Models *[]string      `json:"models"`
	Series []AmountSeries `json:"series"`
}

// CostBucket 按小时聚合的费用桶。
type CostBucket struct {
	Time int    `json:"time"`
	Cost string `json:"cost"`
}

// CostSeries 单个 Key+模型 的费用序列。
type CostSeries struct {
	APIKey  SeriesKey    `json:"apiKey"`
	Model   string       `json:"model"`
	Buckets []CostBucket `json:"buckets"`
}

// CurrencyCostSeries 某一币种下的全部费用序列。
type CurrencyCostSeries struct {
	Currency string       `json:"currency"`
	Series   []CostSeries `json:"series"`
}

// CostData by_api_key/cost 的 bizData。
type CostData struct {
	Start  int                   `json:"start"`
	End    int                   `json:"end"`
	Bucket int                   `json:"bucket"`
	Models *[]string             `json:"models"`
	Data   *[]CurrencyCostSeries `json:"data"`
}
