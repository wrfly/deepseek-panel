package deepseek

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrorKind 错误分类。
type ErrorKind int

const (
	ErrNetwork ErrorKind = iota
	ErrHTTP
	ErrUnauthorized
	ErrServer
	ErrDecode
)

// APIError API 调用错误。
type APIError struct {
	Kind    ErrorKind
	Code    int // HTTP 状态码或接口业务码
	Message string
}

func (e *APIError) Error() string {
	return e.Message
}

// NewAPIError 构造错误。
func NewAPIError(kind ErrorKind, code int, message string) *APIError {
	return &APIError{Kind: kind, Code: code, Message: message}
}

// 判断错误是否为某一类别。
func IsUnauthorized(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Kind == ErrUnauthorized
}

// Envelope 平台接口的统一信封。
type Envelope struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data *struct {
		BizCode int             `json:"bizCode"`
		BizMsg  string          `json:"bizMsg"`
		BizData json.RawMessage `json:"bizData"`
	} `json:"data"`
}

// Client DeepSeek 平台会话 API 客户端。
// 与 Swift DeepSeekClient 对应：同样的请求头与信封校验逻辑。
type Client struct {
	token string
	base  string
	http  *http.Client
}

// New 创建客户端。
func New(token string) *Client {
	return &Client{
		token: token,
		base:  "https://platform.deepseek.com/api/v0",
		http:  &http.Client{Timeout: 60 * time.Second},
	}
}

// SetBase 测试用：替换接口地址。
func (c *Client) SetBase(base string) { c.base = base }

// FetchSummary 获取余额与累计消耗。
func (c *Client) FetchSummary() (*UserSummary, error) {
	var out UserSummary
	if err := c.get("users/get_user_summary", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FetchKeys 获取 API Key 列表。
func (c *Client) FetchKeys() ([]APIKeyInfo, error) {
	var list APIKeyList
	if err := c.get("users/get_api_keys", nil, &list); err != nil {
		return nil, err
	}
	return list.APIKeys, nil
}

// FetchAmount 按 Key 获取 Token 用量。
func (c *Client) FetchAmount(start, end int64, tz int) (*UsageAmountData, error) {
	var out UsageAmountData
	if err := c.get("usage/by_api_key/amount", url.Values{
		"start": {fmt.Sprintf("%d", start)},
		"end":   {fmt.Sprintf("%d", end)},
		"tz":    {fmt.Sprintf("%d", tz)},
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FetchCost 按 Key 获取费用。
func (c *Client) FetchCost(start, end int64, tz int) (*CostData, error) {
	var out CostData
	if err := c.get("usage/by_api_key/cost", url.Values{
		"start": {fmt.Sprintf("%d", start)},
		"end":   {fmt.Sprintf("%d", end)},
		"tz":    {fmt.Sprintf("%d", tz)},
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) get(path string, query url.Values, out any) error {
	u := c.base + "/" + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return NewAPIError(ErrNetwork, 0, "网络请求失败")
	}
	req.Header.Set("accept", "application/json")
	req.Header.Set("authorization", "Bearer "+c.token)
	req.Header.Set("user-agent",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36")
	req.Header.Set("x-client-platform", "web")
	req.Header.Set("referer", "https://platform.deepseek.com/usage")

	resp, err := c.http.Do(req)
	if err != nil {
		return NewAPIError(ErrNetwork, 0, "网络请求失败，请检查网络连接")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return NewAPIError(ErrUnauthorized, resp.StatusCode, "Token 无效或已过期，请在“设置”中更新")
		}
		return NewAPIError(ErrHTTP, resp.StatusCode, fmt.Sprintf("请求失败（HTTP %d）", resp.StatusCode))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return NewAPIError(ErrNetwork, 0, "网络请求失败，请检查网络连接")
	}

	var envelope Envelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return NewAPIError(ErrDecode, 0, "数据解析失败："+truncate(err.Error()))
	}
	if envelope.Code != 0 {
		msg := envelope.Msg
		if msg == "" {
			msg = "未知错误"
		}
		return NewAPIError(ErrServer, envelope.Code, "接口返回错误："+msg)
	}
	if envelope.Data == nil {
		return NewAPIError(ErrDecode, 0, "空响应数据")
	}
	if envelope.Data.BizCode != 0 {
		msg := envelope.Data.BizMsg
		if msg == "" {
			msg = "未知错误"
		}
		return NewAPIError(ErrServer, envelope.Data.BizCode, "接口返回错误："+msg)
	}
	if len(envelope.Data.BizData) == 0 || string(envelope.Data.BizData) == "null" {
		return NewAPIError(ErrDecode, 0, "空业务数据")
	}
	if err := json.Unmarshal(envelope.Data.BizData, out); err != nil {
		return NewAPIError(ErrDecode, 0, "数据解析失败："+truncate(err.Error()))
	}
	return nil
}

func truncate(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}

// MessageForError 把错误转为用户可读文案，与 Swift StatusBarController.message(for:) 对应。
func MessageForError(err error) string {
	if err == nil {
		return ""
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Message
	}
	return "发生错误：" + err.Error()
}
