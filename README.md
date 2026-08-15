# DeepSeek 用量面板

> 🐋 跨平台版（Go + Wails v2）：**一份代码，同时构建 macOS 与 Linux**。
> 原 macOS 版（Swift/SwiftUI）已整体移植为 Go，功能与界面保持一致。

一个桌面小应用：在系统托盘/菜单栏常驻显示 DeepSeek 平台余额，点击打开用量面板，查看每个 API Key 的用量与费用。

## 平台差异

| | macOS | Linux |
| --- | --- | --- |
| 常驻位置 | 菜单栏（NSStatusItem，🐋 emoji + 余额文字，无 Dock 图标） | 系统托盘（AppIndicator + 透明占位图标，实际显示 🐋 emoji + 文字，需桌面环境支持托盘，如 KDE / XFCE / GNOME+扩展） |
| 面板 | 点击菜单栏 → 打开面板窗口 | 启动即显示面板窗口（托盘菜单可随时唤出） |
| 再次启动 | 单实例，自动唤起已有窗口 | 单实例，第二个进程会通过 unix socket 唤醒已有窗口 |
| Token 存储 | 本地文件（0600 权限，见下） | 本地文件（0600 权限） |

> 注：原 Swift 版把 Token 存在 macOS 钥匙串里；跨平台合并版统一改为本地文件
> `<配置目录>/deepseek-panel/token`（macOS 为 `~/Library/Application Support`，Linux 为 `~/.config`），权限 0600。

## 功能

- 托盘/菜单栏：🐋 emoji + 文字（图标为透明占位），可在设置中选择「今日花费 + Token / 今日花费 / 今日 Token / 余额 / 仅图标」；悬停提示含余额、已消费与更新时间
- 用量面板窗口：
  - 余额头卡：TOTAL TOKENS / EST. COST、缓存命中量与命中率
  - TOKENS BY MODEL / COST BY MODEL（带占比）
  - 费用趋势图：按小时/天展示，悬停查看具体数值，费用与 Token 可切换
  - 各 Key 用量排行 + 费用分布饼图 + 缓存命中率标签
  - 预算进度条：今日 / 本月 / 各 Key 的每日与每月，超支变红
  - 用量热力图：GitHub 风格，最近 24 周 × 7 天（按 Token 或按消耗）
- 历史消费本地缓存：自动按小时累积，回填最近 168 天，历史数据不重复远程拉取
- 顶部周期标签：今天 ↔ 24小时 循环、7天、本月 ↔ 30天 ↔ 上个月 循环（设置页可选全部周期）
- 「预算管理」页：全局每日/每月预算 + 每个 API Key 的每日/每月预算；Key 列表取自 get_api_keys（与统计窗口无关），
  消耗按今日/本月独立统计，面板顶部按进度条显示，超支变红
- 所有设置集中在「设置」页：统计周期、显示币种、刷新间隔、热力图指标、开机自启、本地模拟数据（离线测试）
- 一键打开平台用量页面

## 构建

### Linux

```bash
# 1) 依赖（Ubuntu/Debian，有 root 时）：
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev

#    没有 root 时，运行脚本把开发包解压到用户目录（无需 sudo）：
./scripts/setup-linux-deps.sh   # 之后按提示 export 两个 PKG_CONFIG 变量

# 2) 构建：
make build          # 产物 build/deepseek-panel
make run            # 构建并运行
make dump           # 无界面自测（DEEPSEEK_PANEL_MOCK=1 用离线模拟数据）
sudo make install   # 安装到 /usr/local/bin
```

### macOS

在 macOS 上执行（需要 Xcode Command Line Tools）：

```bash
make mac            # 生成 build/DeepSeekPanel.app（LSUIElement：仅菜单栏）
cp -r build/DeepSeekPanel.app /Applications/
```

### Chrome 扩展

桌面版的全部功能也做成了 Chrome 扩展（同一份前端与统计逻辑的 JS 移植）：

1. 同步前端资源并校验：`./scripts/build-extension.sh`
2. 打开 `chrome://extensions`，开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择仓库的 `extension/` 目录

与桌面版的差异：

- 没有托盘：扩展图标上显示 badge（今日 Token / 费用，可在设置中选择显示内容），点击图标打开完整面板
- 数据与设置存在 Chrome 本地（`chrome.storage.local`），Token 不落盘
- 预算超支时弹系统通知
- 请求头（UA / Referer / x-client-platform）由 declarativeNetRequest 规则补齐，与桌面版一致
- 改了 `frontend/dist` 后需要重新运行 `./scripts/build-extension.sh` 同步

## 使用

1. 首次启动会在设置中提示填写 Token（应用无 Token 时面板顶部显示提示）。
2. 获取 Token：浏览器登录 <https://platform.deepseek.com>，打开用量页面，
   在开发者工具 Network 中找任意 `api/v0/...` 请求，复制请求头
   `authorization: Bearer ...` 中 Bearer 后面的值（这是网页会话 Token，不是 `sk-` 开头的 API Key）。
3. 会话 Token 会过期，过期后菜单提示，重新获取粘贴即可。
4. 想离线看看界面：设置里打开「使用本地模拟数据」，或 `DEEPSEEK_PANEL_MOCK=1` 启动。

## 数据接口

| 用途 | 接口 |
| --- | --- |
| 余额与累计消耗 | `GET /api/v0/users/get_user_summary` |
| API Key 列表（名称） | `GET /api/v0/users/get_api_keys` |
| 按 Key 的 token 用量 | `GET /api/v0/usage/by_api_key/amount?start=&end=&tz=` |
| 按 Key 的费用 | `GET /api/v0/usage/by_api_key/cost?start=&end=&tz=` |

注意：这两个用量接口要求跨天查询时 `start`/`end` 都必须是当地时区的 00:00，且跨度不超过 31 天，否则返回 `INVALID_PARAM`。应用会自动按天对齐请求窗口（每批最多 28 天），再在本地过滤出实际统计区间。

## 目录结构

- `main.go` / `app.go`：Wails 应用入口、绑定方法与刷新循环
- `internal/deepseek/`：平台 API 客户端与模型
- `internal/panel/`：统计周期、聚合、趋势存储、设置、Token 存储、模拟数据、热力图、开机自启
- `internal/tray/`：跨平台托盘（macOS 原生 NSStatusItem；Linux AppIndicator，均挂在 Wails 事件循环上）
- `frontend/dist/`：Web 前端（面板 + 设置，ECharts 图表），随二进制内嵌，无构建步骤
- `scripts/`：build-mac.sh（macOS 打包）、setup-linux-deps.sh（无 root 装依赖）、gen_icon.go（托盘图标）
- `App/Info.plist`：macOS bundle 配置（`LSUIElement` 隐藏 Dock 图标）

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DEEPSEEK_PANEL_MOCK=1` | 使用本地模拟数据（离线测试） |
| `DEEPSEEK_PANEL_TEST_TOKEN` | 临时指定 Token（不落盘） |
| `DEEPSEEK_PANEL_DEBUG=1` | 打印调试信息 |