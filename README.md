# DeepSeek 用量面板

> 🐋 本项目由 **DeepSeek V4 Pro** 编写。

一个 macOS 菜单栏小应用：在状态栏常驻显示 DeepSeek 平台余额，点击展开菜单查看每个 API Key 的用量与费用。

## 功能

- 状态栏：🐋 logo + 当前余额（默认 CNY，可在设置切换 USD）
- 点击展开一张用量面板：
  - 余额头卡：TOTAL TOKENS / EST. COST、缓存命中量与命中率
  - TOKENS BY MODEL / COST BY MODEL（带占比）
  - 费用趋势图：按小时/天展示，悬停查看具体数值，费用与 Token 可切换
  - 各 Key 用量排行 + 费用分布饼图 + 缓存命中率
- 历史消费本地缓存：自动按小时累积，回填最近 7 天，历史数据不重复远程拉取
- 所有设置集中在「设置…」窗口：统计周期（今天 / 24 小时 / 7 天 / 本月）、
  显示币种、刷新间隔、开机自启、本地模拟数据（离线测试）
- Token 保存在 macOS 钥匙串（Keychain）中
- 一键打开平台用量页面

## 构建与安装

```bash
make build      # 生成 dist/DeepSeekPanel.app
make install    # 复制到 /Applications（开机自启功能建议放这里）
make run        # 构建并启动
make dump       # 无界面自测：拉取并打印余额/用量
```

应用无 Dock 图标，只在菜单栏显示。首次启动会使用内置的初始 Token；如果失效，点击菜单栏图标 → 设置…，粘贴新的 Token 后保存。

## 关于 Token

本应用使用的是 DeepSeek 平台网页会话的 Bearer Token（不是 `sk-` 开头的 API Key）。获取方式：

1. 浏览器登录 <https://platform.deepseek.com>
2. 打开用量页面，在开发者工具 Network 中找任意 `api/v0/...` 请求
3. 复制请求头 `authorization: Bearer ...` 中 Bearer 后面的值

这类会话 Token 会过期，过期后菜单会提示，重新获取并粘贴到设置中即可。

## 数据接口

| 用途 | 接口 |
| --- | --- |
| 余额与累计消耗 | `GET /api/v0/users/get_user_summary` |
| API Key 列表（名称） | `GET /api/v0/users/get_api_keys` |
| 按 Key 的 token 用量 | `GET /api/v0/usage/by_api_key/amount?start=&end=&tz=` |
| 按 Key 的费用 | `GET /api/v0/usage/by_api_key/cost?start=&end=&tz=` |

注意：这两个用量接口要求跨天查询时 `start`/`end` 都必须是当地时区的 00:00，且跨度不超过 31 天，否则返回 `INVALID_PARAM`。应用会自动按天对齐请求窗口，再在本地过滤出实际统计区间。

## 目录结构

- `Sources/DeepSeekPanel/`：Swift 源码（API 客户端、模型、聚合、菜单栏 UI、设置窗口）
- `App/Info.plist`：应用 bundle 配置（`LSUIElement` 隐藏 Dock 图标）
- `scripts/`：构建与图标生成脚本
