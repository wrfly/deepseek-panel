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
    private var isMenuOpen = false
    private var panelView: UsagePanelView?
    private var errorItem: NSMenuItem?
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
        rebuildMenu()
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
                window: window
            )
            snapshot.errorMessage = nil
            snapshot.lastUpdated = now
            finishRefresh()
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
                finishRefresh()
                return
            }
            token = stored
        }

        let client = DeepSeekClient(token: token)
        if period != .today {
            await ensureHourlyHistory(client: client, now: now, tz: tz)
        }
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
                window: window
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

        finishRefresh()
    }

    /// 保证最近 7 天 + 今天都有按小时的数据；已缓存的日期不再远程拉取。
    private func ensureHourlyHistory(client: DeepSeekClient, now: Date, tz: Int) async {
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: now)

        for offset in 0..<7 {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: todayStart) else {
                continue
            }
            let start = Int(day.timeIntervalSince1970)
            let end = start + 86400
            if TrendStore.coverageCount(from: start, to: end) >= 24 { continue }
            await mergeHourlyDay(client: client, start: start, end: end, tz: tz)
        }

        let todayStartInt = Int(todayStart.timeIntervalSince1970)
        if TrendStore.coverageCount(from: todayStartInt, to: todayStartInt + 86400) < 24,
           shouldFetchTodayHourly(now: now) {
            lastHourlyFetch = now
            await mergeHourlyDay(
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

    private func mergeHourlyDay(client: DeepSeekClient, start: Int, end: Int, tz: Int) async {
        guard let amount = try? await client.fetchAmount(start: start, end: end, tz: tz),
              let cost = try? await client.fetchCost(start: start, end: end, tz: tz) else {
            return
        }

        var points: [TrendPoint] = []
        for series in amount.series {
            for bucket in series.buckets {
                var point = points.first { $0.time == bucket.time }
                    ?? TrendPoint(time: bucket.time, tokens: 0, costCNY: 0, costUSD: 0)
                point.tokens += (bucket.usage.responseToken ?? 0)
                    + (bucket.usage.promptCacheHitToken ?? 0)
                    + (bucket.usage.promptCacheMissToken ?? 0)
                if let index = points.firstIndex(where: { $0.time == bucket.time }) {
                    points[index] = point
                } else {
                    points.append(point)
                }
            }
        }
        for currency in cost.data ?? [] {
            let isUSD = currency.currency == "USD"
            for series in currency.series {
                for bucket in series.buckets {
                    let value = Double(bucket.cost) ?? 0
                    if let index = points.firstIndex(where: { $0.time == bucket.time }) {
                        if isUSD {
                            points[index].costUSD += value
                        } else {
                            points[index].costCNY += value
                        }
                    }
                }
            }
        }
        // 补齐一天内缺失的小时（无使用量的整天接口会返回空 series），
        // 保证覆盖判定稳定，避免每次都重拉。
        var byTime = Dictionary(uniqueKeysWithValues: points.map { ($0.time, $0) })
        var time = start
        while time < end {
            if byTime[time] == nil {
                byTime[time] = TrendPoint(time: time, tokens: 0, costCNY: 0, costUSD: 0)
            }
            time += 3600
        }
        TrendStore.replaceDay(Array(byTime.values), dayStart: start, dayEnd: end)
    }

    /// 图表数据 = 本地小时缓存 + 未缓存日期的远程日粒度点。
    private static func combinedTrend(window: StatsWindow, fetched: [TrendPoint]) -> [TrendPoint] {
        let cached = TrendStore.load().values.filter { window.contains(time: $0.time) }
        var merged = Dictionary(uniqueKeysWithValues: cached.map { ($0.time, $0) })
        for point in fetched {
            let dayStart = (point.time / 86400) * 86400
            let dayEnd = dayStart + 86400
            let covered = cached.contains { $0.time >= dayStart && $0.time < dayEnd }
            if !covered {
                merged[point.time] = point
            }
        }
        return merged.values.sorted { $0.time < $1.time }
    }

    private func finishRefresh() {
        if isMenuOpen {
            updateInPlace()
        } else {
            rebuildMenu()
        }
    }

    private func updateInPlace() {
        if let panelView, snapshot.summary != nil || !snapshot.report.keys.isEmpty {
            panelView.update(
                summary: snapshot.summary,
                report: snapshot.report,
                currency: AppSettings.displayCurrency,
                periodTitle: AppSettings.period.title,
                lastUpdated: snapshot.lastUpdated
            )
        }
        if let errorItem, let message = snapshot.errorMessage {
            errorItem.attributedTitle = Self.styled(message, size: 12, color: .systemRed)
        }
        updateButtonTitle()
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self

        if let error = snapshot.errorMessage {
            let item = NSMenuItem()
            item.attributedTitle = Self.styled(error, size: 12, color: .systemRed)
            item.isEnabled = false
            errorItem = item
            menu.addItem(item)
        } else {
            errorItem = nil
        }

        if snapshot.summary != nil || !snapshot.report.keys.isEmpty {
            if panelView == nil {
                panelView = UsagePanelView(
                    summary: snapshot.summary,
                    report: snapshot.report,
                    currency: AppSettings.displayCurrency,
                    periodTitle: AppSettings.period.title,
                    lastUpdated: snapshot.lastUpdated
                )
            } else {
                panelView?.update(
                    summary: snapshot.summary,
                    report: snapshot.report,
                    currency: AppSettings.displayCurrency,
                    periodTitle: AppSettings.period.title,
                    lastUpdated: snapshot.lastUpdated
                )
            }
            let item = NSMenuItem()
            item.view = panelView
            menu.addItem(item)
        } else if snapshot.errorMessage == nil {
            let header = NSMenuItem()
            header.attributedTitle = Self.styled("DeepSeek 用量面板", size: 13, weight: .semibold)
            header.isEnabled = false
            menu.addItem(header)

            let loading = NSMenuItem()
            loading.attributedTitle = Self.styled("加载中…", size: 12, color: .secondaryLabelColor)
            loading.isEnabled = false
            menu.addItem(loading)
        }

        menu.addItem(.separator())

        let refreshItem = NSMenuItem(
            title: "刷新",
            action: #selector(refreshTapped),
            keyEquivalent: "r"
        )
        refreshItem.target = self
        menu.addItem(refreshItem)

        let openItem = NSMenuItem(
            title: "打开平台用量页",
            action: #selector(openUsagePage),
            keyEquivalent: ""
        )
        openItem.target = self
        menu.addItem(openItem)

        let settingsItem = NSMenuItem(
            title: "设置…",
            action: #selector(openSettings),
            keyEquivalent: ","
        )
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        updateButtonTitle()

        if ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_DEBUG"] == "1" {
            for item in menu.items {
                print("DEBUG menu item: \(item.title)")
            }
        }
    }

    private func updateButtonTitle() {
        guard let button = statusItem.button else { return }
        button.image = nil
        if let summary = snapshot.summary,
           let wallet = summary.normalWallets.first(where: {
               $0.currency == AppSettings.displayCurrency
           }) {
            button.title = "🐋 " + formatMoney(
                parseDecimal(wallet.balance),
                currency: wallet.currency
            )
        } else if snapshot.errorMessage != nil, snapshot.summary == nil {
            button.title = "⚠️"
        } else {
            button.title = "🐋"
        }
        if ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_DEBUG"] == "1" {
            print("DEBUG status title: \(button.title)")
        }
    }

    @objc private func refreshTapped() {
        refreshNow()
    }

    @objc private func periodChanged(_ note: Notification) {
        guard let raw = note.object as? String,
              let period = StatsPeriod(rawValue: raw) else { return }
        AppSettings.period = period
        refreshNow()
    }

    @objc private func openUsagePage() {
        NSWorkspace.shared.open(URL(string: "https://platform.deepseek.com/usage")!)
    }

    @objc private func openSettings() {
        NotificationCenter.default.post(name: .openSettings, object: nil)
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

extension StatusBarController: NSMenuDelegate {
    func menuWillOpen(_ menu: NSMenu) {
        isMenuOpen = true
    }

    func menuDidClose(_ menu: NSMenu) {
        isMenuOpen = false
        rebuildMenu()
    }
}
