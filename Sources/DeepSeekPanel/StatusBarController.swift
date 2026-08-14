import AppKit

@MainActor
final class StatusBarController: NSObject {
    private struct Snapshot {
        var summary: UserSummary?
        var report = UsageReport()
        var errorMessage: String?
        var lastUpdated: Date?
    }

    private let statusItem: NSStatusItem
    private var refreshTask: Task<Void, Never>?
    private var snapshot = Snapshot()
    private var didAutoOpenMenu = false
    private var panelView: UsagePanelView?
    private var lastHourlyFetch: Date?
    private var failureStreak = 0

    override init() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    }

    func start() {
        if ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_DEBUG"] == "1" {
            print("DEBUG args: \(CommandLine.arguments.joined(separator: " | "))")
        }
        if let button = statusItem.button {
            button.title = "🐋"
            button.toolTip = "DeepSeek 用量面板"
        }
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(periodChanged(_:)),
            name: .periodChanged,
            object: nil
        )
        buildMenu()
        refreshNow()

        if ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_DEBUG_MENU"] == "1"
            || CommandLine.arguments.contains("--open-menu") {
            print("DEBUG scheduling open-menu")
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                print("DEBUG open-menu fired")
                guard let self, !self.didAutoOpenMenu else { return }
                self.didAutoOpenMenu = true
                NSApp.activate(ignoringOtherApps: true)
                print("DEBUG clicking status button")
                self.statusItem.button?.performClick(nil)
            }
        }

        if let argument = CommandLine.arguments.first(where: {
            $0.hasPrefix("--set-period=")
        }) {
            let value = String(argument.dropFirst("--set-period=".count))
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) {
                NotificationCenter.default.post(name: .periodChanged, object: value)
            }
        }

        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                let minutes = AppSettings.refreshIntervalMinutes
                let streak = min(self?.failureStreak ?? 0, 3)
                let multiplier = UInt64(1) << UInt64(streak)
                do {
                    try await Task.sleep(
                        nanoseconds: UInt64(minutes) * 60_000_000_000 * multiplier
                    )
                } catch {
                    return
                }
                if Task.isCancelled { return }
                await self?.refresh()
            }
        }
    }

    func stop() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    func refreshNow() {
        Task { await self.refresh() }
    }

    private func refresh() async {
        let useMock = AppSettings.useMockData
            || ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_MOCK"] == "1"
        let period = AppSettings.period
        let now = Date()
        let window = period.window(now: now)
        let tz = TimeZone.current.secondsFromGMT(for: now)

        if useMock {
            let (summary, keys, amount, cost) = MockData.fetch(window: window, tz: tz)
            snapshot.summary = summary
            snapshot.report = UsageAggregator.build(
                keys: keys,
                amount: amount,
                cost: cost,
                window: window,
                currency: AppSettings.displayCurrency
            )
            snapshot.errorMessage = nil
            snapshot.lastUpdated = now
            populateMockHeatmap(tz: tz)
            refreshPanel()
            return
        }

        let token: String
        if let testToken = ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_TEST_TOKEN"],
           !testToken.isEmpty {
            token = testToken
        } else {
            guard let stored = Keychain.load(), !stored.isEmpty else {
                snapshot.errorMessage = "尚未配置 Token，请在“设置”中填写。"
                snapshot.summary = nil
                snapshot.report = UsageReport()
                refreshPanel()
                return
            }
            token = stored
        }

        let client = DeepSeekClient(token: token)
        // 无论周期，都保证最近 7 天按小时数据完整，供趋势图与热力图使用（幂等）。
        await ensureHourlyHistory(client: client, now: now, tz: tz)
        do {
            async let summaryResult = client.fetchSummary()
            async let keysResult = client.fetchKeys()
            async let amountResult = client.fetchAmount(
                start: window.requestStart,
                end: window.requestEnd,
                tz: tz
            )
            async let costResult = client.fetchCost(
                start: window.requestStart,
                end: window.requestEnd,
                tz: tz
            )
            let (summary, keys, amount, cost) = try await (
                summaryResult,
                keysResult,
                amountResult,
                costResult
            )

            var report = UsageAggregator.build(
                keys: keys,
                amount: amount,
                cost: cost,
                window: window,
                currency: AppSettings.displayCurrency
            )
            let fetchedTrend = report.trend

            // 历史趋势：以本地按小时累积的缓存为准，远程只补齐缺失的小时。
            if period == .today {
                TrendStore.replaceDay(
                    fetchedTrend,
                    dayStart: window.requestStart,
                    dayEnd: window.requestEnd
                )
            }
            report.trend = Self.combinedTrend(window: window, fetched: fetchedTrend)

            snapshot.summary = summary
            snapshot.report = report
            snapshot.errorMessage = nil
            snapshot.lastUpdated = now
            failureStreak = 0
        } catch {
            snapshot.errorMessage = Self.message(for: error)
            failureStreak += 1
        }

        refreshPanel()
    }

    /// 主动回填最近 24 周（对应热力图范围）的按小时数据；已缓存的日期不再远程拉取。
    /// 用量接口要求跨天查询跨度 ≤31 天，这里按每批 28 天分批拉取。
    private func ensureHourlyHistory(client: DeepSeekClient, now: Date, tz: Int) async {
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: now)
        let totalDays = 24 * 7  // 168 天，与热力图 24 周一致

        // 历史（不含今天）：从最远的 167 天前往今天方向回填。
        var earliestOffset = totalDays - 1  // 167
        while earliestOffset > 0 {
            let batchDays = min(28, earliestOffset)
            let endOffset = earliestOffset
            let startOffset = earliestOffset - batchDays + 1
            guard let endDay = calendar.date(byAdding: .day, value: -endOffset, to: todayStart),
                  let startDay = calendar.date(byAdding: .day, value: -startOffset, to: todayStart) else {
                break
            }
            let start = Int(startDay.timeIntervalSince1970)
            let end = Int(endDay.timeIntervalSince1970) + 86400
            if TrendStore.coverageCount(from: start, to: end) < batchDays * 24 {
                await fetchAndMergeRange(client: client, start: start, end: end, tz: tz)
            }
            earliestOffset -= batchDays
        }

        // 今天：数据仍在增长，按 15 分钟节流持续补齐，而不是依赖覆盖判定
        // （今天尚未结束，覆盖永远到不了 24 小时，否则整天数据会被一次性冻结）。
        if shouldFetchTodayHourly(now: now) {
            lastHourlyFetch = now
            let todayStartInt = Int(todayStart.timeIntervalSince1970)
            await fetchAndMergeRange(
                client: client,
                start: todayStartInt,
                end: todayStartInt + 86400,
                tz: tz
            )
        }
    }

    /// 今天的小时数据最多每 15 分钟补一次，避免频繁请求触发限流。
    private func shouldFetchTodayHourly(now: Date) -> Bool {
        guard let last = lastHourlyFetch else { return true }
        return now.timeIntervalSince(last) >= 15 * 60
    }

    private func fetchAndMergeRange(client: DeepSeekClient, start: Int, end: Int, tz: Int) async {
        guard let amount = try? await client.fetchAmount(start: start, end: end, tz: tz),
              let cost = try? await client.fetchCost(start: start, end: end, tz: tz) else {
            return
        }
        Self.mergeRange(amount: amount, cost: cost, start: start, end: end)
    }

    /// 把 [start, end) 范围内的 amount + cost 合并成按小时的点，整体替换进 TrendStore（可跨多天）。
    private static func mergeRange(amount: UsageAmountData, cost: CostData, start: Int, end: Int) {
        var byTime: [Int: TrendPoint] = [:]
        for series in amount.series {
            for bucket in series.buckets {
                var point = byTime[bucket.time] ?? TrendPoint(time: bucket.time)
                point.tokens += (bucket.usage.responseToken ?? 0)
                    + (bucket.usage.promptCacheHitToken ?? 0)
                    + (bucket.usage.promptCacheMissToken ?? 0)
                byTime[bucket.time] = point
            }
        }
        for currency in cost.data ?? [] {
            let isUSD = currency.currency == "USD"
            for series in currency.series {
                for bucket in series.buckets {
                    var point = byTime[bucket.time] ?? TrendPoint(time: bucket.time)
                    let value = Double(bucket.cost) ?? 0
                    if isUSD {
                        point.costUSD += value
                    } else {
                        point.costCNY += value
                    }
                    byTime[bucket.time] = point
                }
            }
        }
        // 补齐范围内缺失的小时（无使用量的整天接口会返回空 series），
        // 保证覆盖判定稳定，避免每次都重拉。
        var time = start
        while time < end {
            if byTime[time] == nil {
                byTime[time] = TrendPoint(time: time, tokens: 0, costCNY: 0, costUSD: 0)
            }
            time += 3600
        }
        TrendStore.replaceRange(Array(byTime.values), start: start, end: end)
    }

    /// mock 模式也填充最近 24 周（与热力图范围一致）的缓存，便于离线测试 UI。
    private func populateMockHeatmap(tz: Int) {
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: Date())
        for offset in 0..<(24 * 7) {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: todayStart) else {
                continue
            }
            let start = Int(day.timeIntervalSince1970)
            let end = start + 86400
            // 已缓存的天不再重复生成（幂等）。
            if TrendStore.coverageCount(from: start, to: end) >= 24 { continue }
            let mockWindow = StatsWindow(
                filterStart: start,
                filterEnd: end,
                requestStart: start,
                requestEnd: end
            )
            let (_, _, amount, cost) = MockData.fetch(window: mockWindow, tz: tz)
            Self.mergeRange(amount: amount, cost: cost, start: start, end: end)
        }
    }

    /// 图表数据 = 本地小时缓存 + 未缓存日期的远程日粒度点。
    private static func combinedTrend(window: StatsWindow, fetched: [TrendPoint]) -> [TrendPoint] {
        let cached = TrendStore.load().values.filter { window.contains(time: $0.time) }
        var merged = Dictionary(uniqueKeysWithValues: cached.map { ($0.time, $0) })
        // 已缓存完整天的小时数据优先；用 Set 判断某天是否已覆盖，避免 O(n·m) 扫描。
        let coveredDays = Set(cached.map { ($0.time / 86400) * 86400 })
        for point in fetched where !coveredDays.contains((point.time / 86400) * 86400) {
            merged[point.time] = point
        }
        return merged.values.sorted { $0.time < $1.time }
    }

    private func refreshPanel() {
        panelView?.update(
            summary: snapshot.summary,
            report: snapshot.report,
            currency: AppSettings.displayCurrency,
            periodTitle: AppSettings.period.title,
            lastUpdated: snapshot.lastUpdated,
            errorMessage: snapshot.errorMessage
        )
        updateButtonTitle()
    }

    /// 菜单只构建一次；后续数据变化通过 panelView.update 原地刷新，
    /// 避免在菜单打开期间替换 menu 导致白屏。
    private func buildMenu() {
        let menu = NSMenu()
        menu.autoenablesItems = false

        let panel = UsagePanelView(
            summary: nil,
            report: UsageReport(),
            currency: AppSettings.displayCurrency,
            periodTitle: AppSettings.period.title,
            lastUpdated: nil,
            errorMessage: nil
        )
        panelView = panel
        let panelItem = NSMenuItem()
        panelItem.view = panel
        menu.addItem(panelItem)

        menu.addItem(.separator())

        let openItem = NSMenuItem(
            title: "打开平台用量页",
            action: #selector(openUsagePage),
            keyEquivalent: ""
        )
        openItem.target = self
        menu.addItem(openItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func updateButtonTitle() {
        guard let button = statusItem.button else { return }
        button.image = nil
        if let summary = snapshot.summary {
            // 与面板头卡一致：所选币种没有钱包时回退到第一个可用钱包。
            let wallet = summary.normalWallets.first(where: {
                $0.currency == AppSettings.displayCurrency
            }) ?? summary.normalWallets.first
            if let wallet {
                button.title = "🐋 " + formatMoney(
                    parseDecimal(wallet.balance),
                    currency: wallet.currency
                )
            } else {
                button.title = "🐋"
            }
        } else if snapshot.errorMessage != nil {
            button.title = "⚠️"
        } else {
            button.title = "🐋"
        }
        button.toolTip = Self.tooltipText(snapshot: snapshot)
        if ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_DEBUG"] == "1" {
            print("DEBUG status title: \(button.title)")
        }
    }

    /// 悬停提示：显示数据新鲜度或错误信息，弥补状态栏空间有限的不足。
    private static func tooltipText(snapshot: Snapshot) -> String {
        if let error = snapshot.errorMessage, snapshot.summary == nil {
            return error
        }
        var parts = ["DeepSeek 用量面板"]
        if let lastUpdated = snapshot.lastUpdated {
            parts.append("最后更新 \(timeFormatter.string(from: lastUpdated))")
        } else if snapshot.errorMessage == nil {
            parts.append("加载中…")
        }
        if let error = snapshot.errorMessage, snapshot.summary != nil {
            parts.append(error)
        }
        return parts.joined(separator: " · ")
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    @objc private func periodChanged(_ note: Notification) {
        guard let raw = note.object as? String,
              let period = StatsPeriod(rawValue: raw) else { return }
        AppSettings.period = period
        refreshNow()
    }

    @objc private func openUsagePage() {
        NSWorkspace.shared.open(URL(string: "https://platform.deepseek.com/usage")!)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private static func styled(
        _ text: String,
        size: CGFloat,
        weight: NSFont.Weight = .regular,
        color: NSColor = .labelColor
    ) -> NSAttributedString {
        NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.systemFont(ofSize: size, weight: weight),
                .foregroundColor: color
            ]
        )
    }

    private static func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized:
                return "Token 无效或已过期，请在“设置”中更新"
            case .http(let code):
                return "请求失败（HTTP \(code)）"
            case .server(let message):
                return "接口返回错误：\(message.isEmpty ? "未知错误" : message)"
            case .network:
                return "网络请求失败，请检查网络连接"
            case .decode(let detail):
                return "数据解析失败：\(detail)"
            }
        }
        return "发生错误：\(error.localizedDescription)"
    }
}
