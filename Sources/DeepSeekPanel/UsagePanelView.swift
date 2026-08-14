import AppKit

/// Kaboo 风格用量面板：大数字头卡 + 按模型/按 Key 拆分 + 趋势图。
/// 全部自定义绘制，明暗模式自适应。
final class UsagePanelView: NSView {
    enum TrendMode {
        case cost
        case tokens
    }

    private struct Metrics {
        let headerY: CGFloat
        let heroCaptionY: CGFloat
        let heroValueY: CGFloat
        let heroSubY: CGFloat
        let hairline1Y: CGFloat
        let tokensHeaderY: CGFloat
        let tokensRowsTop: CGFloat
        let costHeaderY: CGFloat
        let costRowsTop: CGFloat
        let hairline2Y: CGFloat
        let requestsY: CGFloat
        let trendHeaderY: CGFloat
        let chartY: CGFloat
        let axisY: CGFloat
        let keysHeaderY: CGFloat
        let rowsTop: CGFloat
        let footerHairlineY: CGFloat
        let footerY: CGFloat
        let totalHeight: CGFloat
        let modelRowH: CGFloat
        let keyRowH: CGFloat
    }

    private enum Font {
        static let title = NSFont.systemFont(ofSize: 12, weight: .medium)
        static let caption = NSFont.systemFont(ofSize: 9, weight: .semibold)
        static let hero = NSFont.monospacedDigitSystemFont(ofSize: 28, weight: .semibold)
        static let heroCost = NSFont.monospacedDigitSystemFont(ofSize: 22, weight: .semibold)
        static let small = NSFont.systemFont(ofSize: 10)
        static let section = NSFont.systemFont(ofSize: 10, weight: .semibold)
        static let name = NSFont.systemFont(ofSize: 11, weight: .medium)
        static let money = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
        static let value = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular)
        static let pill = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .semibold)
        static let tab = NSFont.systemFont(ofSize: 10, weight: .medium)
    }

    private static let panelWidth: CGFloat = 384
    private static let padding: CGFloat = 16
    private static var inner: CGFloat { panelWidth - padding * 2 }

    /// 各 Key / 模型的识别色，依次轮转，系统色自动适配明暗模式。
    private static let palette: [NSColor] = [
        .systemBlue, .systemPurple, .systemTeal, .systemOrange,
        .systemPink, .systemGreen, .systemIndigo, .systemCyan,
    ]

    /// 趋势图模式，跨重建保留。
    private static var trendMode: TrendMode = .cost

    private var summary: UserSummary?
    private var report: UsageReport
    private var currency: String
    private var periodTitle: String
    private var lastUpdated: Date?
    private var errorMessage: String?

    private var periodButtons: [(period: StatsPeriod, button: NSButton)] = []
    private let costButton = NSButton()
    private let tokenButton = NSButton()
    private var currentTrendHeaderY: CGFloat = 0
    private var chartTrackingArea: NSTrackingArea?
    private var hoveredIndex: Int?

    override var isFlipped: Bool { true }

    init(
        summary: UserSummary?,
        report: UsageReport,
        currency: String,
        periodTitle: String,
        lastUpdated: Date?,
        errorMessage: String? = nil
    ) {
        self.summary = summary
        self.report = report
        self.currency = currency
        self.periodTitle = periodTitle
        self.lastUpdated = lastUpdated
        self.errorMessage = errorMessage
        let metrics = Self.metrics(
            modelsCount: report.models.count,
            keysCount: report.keys.count,
            hasError: errorMessage != nil
        )
        super.init(frame: NSRect(x: 0, y: 0, width: Self.panelWidth, height: metrics.totalHeight))
        configurePeriodTabs(metrics: metrics)
        configureToggleButtons(metrics: metrics)
        currentTrendHeaderY = metrics.trendHeaderY
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(
        summary: UserSummary?,
        report: UsageReport,
        currency: String,
        periodTitle: String,
        lastUpdated: Date?,
        errorMessage: String?
    ) {
        self.summary = summary
        self.report = report
        self.currency = currency
        self.periodTitle = periodTitle
        self.lastUpdated = lastUpdated
        self.errorMessage = errorMessage

        let metrics = Self.metrics(
            modelsCount: report.models.count,
            keysCount: report.keys.count,
            hasError: errorMessage != nil
        )
        let targetHeight: CGFloat = isLoading ? 76 : metrics.totalHeight
        if abs(frame.height - targetHeight) > 0.5 {
            setFrameSize(NSSize(width: Self.panelWidth, height: targetHeight))
        }
        if !isLoading, abs(currentTrendHeaderY - metrics.trendHeaderY) > 0.5 {
            currentTrendHeaderY = metrics.trendHeaderY
            costButton.removeFromSuperview()
            tokenButton.removeFromSuperview()
            configureToggleButtons(metrics: metrics)
        }
        for (_, button) in periodButtons {
            button.isHidden = isLoading
        }
        costButton.isHidden = isLoading
        tokenButton.isHidden = isLoading
        stylePeriodTabs()
        needsDisplay = true
    }

    // MARK: - Layout

    private static func metrics(modelsCount: Int, keysCount: Int, hasError: Bool) -> Metrics {
        let top: CGFloat = 14
        let bannerH: CGFloat = hasError ? 22 : 0
        let headerH: CGFloat = 18
        let headerGap: CGFloat = 12
        let heroCaptionH: CGFloat = 12
        let heroValueH: CGFloat = 30
        let heroSubH: CGFloat = 13
        let heroGap: CGFloat = 12
        let sectionH: CGFloat = 22
        let sectionRowGap: CGFloat = 4
        let modelRowH: CGFloat = 17
        let sectionGap: CGFloat = 10
        let requestsH: CGFloat = 18
        let requestsGap: CGFloat = 10
        let trendGap: CGFloat = 6
        let chartH: CGFloat = 56
        let axisH: CGFloat = 12
        let axisGap: CGFloat = 8
        let keyRowH: CGFloat = 46
        let footerTopPad: CGFloat = 12
        let footerH: CGFloat = 16
        let bottom: CGFloat = 14

        var y = top + bannerH
        let headerY = y
        y += headerH + headerGap
        let heroCaptionY = y
        y += heroCaptionH + 2
        let heroValueY = y
        y += heroValueH + 2
        let heroSubY = y
        y += heroSubH + heroGap
        let hairline1Y = y
        y += 1 + 10
        let tokensHeaderY = y
        y += sectionH + sectionRowGap
        let tokensRowsTop = y
        y += CGFloat(max(modelsCount, 1)) * modelRowH + sectionGap
        let costHeaderY = y
        y += sectionH + sectionRowGap
        let costRowsTop = y
        y += CGFloat(max(modelsCount, 1)) * modelRowH + sectionGap
        let hairline2Y = y
        y += 1 + requestsGap
        let requestsY = y
        y += requestsH + 8
        let trendHeaderY = y
        y += sectionH + trendGap
        let chartY = y
        y += chartH
        let axisY = y
        y += axisH + axisGap
        let keysHeaderY = y
        y += sectionH + sectionRowGap
        let rowsTop = y
        let rowsHeight = max(CGFloat(keysCount) * keyRowH, 76)
        y += rowsHeight + 12
        let footerHairlineY = y + footerTopPad
        let footerY = footerHairlineY + 1 + 10
        y = footerY + footerH + bottom

        return Metrics(
            headerY: headerY,
            heroCaptionY: heroCaptionY,
            heroValueY: heroValueY,
            heroSubY: heroSubY,
            hairline1Y: hairline1Y,
            tokensHeaderY: tokensHeaderY,
            tokensRowsTop: tokensRowsTop,
            costHeaderY: costHeaderY,
            costRowsTop: costRowsTop,
            hairline2Y: hairline2Y,
            requestsY: requestsY,
            trendHeaderY: trendHeaderY,
            chartY: chartY,
            axisY: axisY,
            keysHeaderY: keysHeaderY,
            rowsTop: rowsTop,
            footerHairlineY: footerHairlineY,
            footerY: footerY,
            totalHeight: y,
            modelRowH: modelRowH,
            keyRowH: keyRowH
        )
    }

    // MARK: - Controls

    private func configurePeriodTabs(metrics: Metrics) {
        let periods: [StatsPeriod] = [.today, .last24h, .last7d, .thisMonth]
        let labels: [StatsPeriod: String] = [
            .today: "今天",
            .last24h: "24小时",
            .last7d: "7天",
            .thisMonth: "本月",
        ]
        let widths: [CGFloat] = [34, 46, 34, 34]
        let totalWidth = widths.reduce(0, +)
        var x = Self.panelWidth - Self.padding - totalWidth
        for (index, period) in periods.enumerated() {
            let width = widths[index]
            let button = NSButton(frame: NSRect(x: x, y: metrics.headerY, width: width, height: 18))
            button.isBordered = false
            button.title = labels[period] ?? period.rawValue
            button.tag = index
            button.target = self
            button.action = #selector(periodTapped(_:))
            addSubview(button)
            periodButtons.append((period, button))
            x += width
        }
        stylePeriodTabs()
    }

    private func stylePeriodTabs() {
        for (period, button) in periodButtons {
            let selected = period == AppSettings.period
            button.attributedTitle = NSAttributedString(
                string: button.title,
                attributes: [
                    .font: Font.tab,
                    .foregroundColor: selected ? NSColor.labelColor : NSColor.secondaryLabelColor,
                    .underlineStyle: selected ? NSUnderlineStyle.single.rawValue : 0,
                ]
            )
        }
    }

    @objc private func periodTapped(_ sender: NSButton) {
        let periods: [StatsPeriod] = [.today, .last24h, .last7d, .thisMonth]
        guard periods.indices.contains(sender.tag) else { return }
        AppSettings.period = periods[sender.tag]
        stylePeriodTabs()
        NotificationCenter.default.post(
            name: .periodChanged,
            object: periods[sender.tag].rawValue
        )
    }

    private func configureToggleButtons(metrics: Metrics) {
        let width: CGFloat = 46
        let height: CGFloat = 20
        let right = Self.panelWidth - Self.padding
        costButton.frame = NSRect(x: right - width * 2 - 6, y: metrics.trendHeaderY, width: width, height: height)
        tokenButton.frame = NSRect(x: right - width, y: metrics.trendHeaderY, width: width, height: height)

        for button in [costButton, tokenButton] {
            button.isBordered = false
            button.wantsLayer = true
            button.layer?.cornerRadius = height / 2
            button.layer?.masksToBounds = true
            button.target = self
            button.action = #selector(toggleTapped(_:))
            addSubview(button)
        }
        costButton.title = "费用"
        tokenButton.title = "Token"
        styleToggleButtons()
    }

    private func styleToggleButtons() {
        styleButton(costButton, title: "费用", selected: Self.trendMode == .cost)
        styleButton(tokenButton, title: "Token", selected: Self.trendMode == .tokens)
    }

    private func styleButton(_ button: NSButton, title: String, selected: Bool) {
        let foreground: NSColor = selected ? .white : .secondaryLabelColor
        let background: NSColor = selected ? .controlAccentColor : .quaternaryLabelColor
        button.attributedTitle = NSAttributedString(
            string: title,
            attributes: [.font: Font.pill, .foregroundColor: foreground]
        )
        button.layer?.backgroundColor = background.cgColor
    }

    @objc private func toggleTapped(_ sender: NSButton) {
        Self.trendMode = sender === costButton ? .cost : .tokens
        styleToggleButtons()
        needsDisplay = true
    }

    // MARK: - Drawing

    override func draw(_ dirtyRect: NSRect) {
        if isLoading {
            draw("🐋 DeepSeek 用量", x: Self.padding, y: 16, width: Self.inner, font: Font.title, color: .labelColor, alignment: .left)
            draw("加载中…", x: Self.padding, y: 42, width: Self.inner, font: Font.small, color: .secondaryLabelColor, alignment: .center)
            return
        }

        let m = Self.metrics(
            modelsCount: report.models.count,
            keysCount: report.keys.count,
            hasError: errorMessage != nil
        )
        let rightColumnX = Self.padding + 184
        let rightColumnWidth = Self.inner - 184

        if let errorMessage {
            draw(
                "⚠️ \(errorMessage)",
                x: Self.padding,
                y: 8,
                width: Self.inner,
                font: Font.small,
                color: .systemRed,
                alignment: .center
            )
        }

        // 标题
        draw("🐋", x: Self.padding - 2, y: m.headerY, width: 22, font: NSFont.systemFont(ofSize: 14), color: .labelColor, alignment: .left)
        draw("DeepSeek 用量", x: Self.padding + 19, y: m.headerY, width: 150, font: Font.title, color: .labelColor, alignment: .left)

        // 头卡
        let totalTokens = report.models.reduce(0) { $0 + $1.tokens }
        let totalCost = report.models.reduce(0) { $0 + $1.cost(in: currency) }
        let hitTokens = report.keys.reduce(0) { $0 + $1.promptCacheHitTokens }
        let missTokens = report.keys.reduce(0) { $0 + $1.promptCacheMissTokens }
        let totalRequests = report.keys.reduce(0) { $0 + $1.requests }

        draw("TOTAL TOKENS", x: Self.padding, y: m.heroCaptionY, width: 180, font: Font.caption, color: .secondaryLabelColor, alignment: .left)
        draw("EST. COST", x: rightColumnX, y: m.heroCaptionY, width: rightColumnWidth, font: Font.caption, color: .secondaryLabelColor, alignment: .left)
        draw(formatTokens(totalTokens), x: Self.padding, y: m.heroValueY, width: 180, font: Font.hero, color: .labelColor, alignment: .left)
        draw("🐋", x: rightColumnX - 1, y: m.heroValueY + 4, width: 22, font: NSFont.systemFont(ofSize: 15), color: .labelColor, alignment: .left)
        draw(
            formatMoney(totalCost, currency: currency),
            x: rightColumnX + 22,
            y: m.heroValueY + 3,
            width: rightColumnWidth - 22,
            font: Font.heroCost,
            color: .labelColor,
            alignment: .left
        )

        var leftSub = "Cached \(formatTokens(hitTokens))"
        if hitTokens + missTokens > 0 {
            let rate = Double(hitTokens) / Double(hitTokens + missTokens)
            leftSub += " · \(Int((rate * 100).rounded()))% hit"
        }
        draw(leftSub, x: Self.padding, y: m.heroSubY, width: 180, font: Font.small, color: .secondaryLabelColor, alignment: .left)

        var rightSub = ""
        let heroWallet = summary?.normalWallets.first { $0.currency == currency }
            ?? summary?.normalWallets.first
        if let heroWallet {
            rightSub += "Balance \(formatMoney(parseDecimal(heroWallet.balance), currency: heroWallet.currency))"
        }
        if let spent = summary?.totalCosts.first(where: { $0.currency == currency }) {
            if !rightSub.isEmpty { rightSub += " · " }
            rightSub += "Spent \(formatMoney(parseDecimal(spent.amount), currency: spent.currency))"
        }
        draw(rightSub, x: rightColumnX, y: m.heroSubY, width: rightColumnWidth, font: Font.small, color: .secondaryLabelColor, alignment: .left)

        drawHairline(at: m.hairline1Y)

        // 按模型的 Token
        draw("TOKENS BY MODEL", x: Self.padding, y: m.tokensHeaderY + 4, width: 200, font: Font.section, color: .labelColor, alignment: .left)
        if report.models.isEmpty {
            draw("暂无数据", x: Self.padding, y: m.tokensRowsTop + 2, width: Self.inner, font: Font.small, color: .tertiaryLabelColor, alignment: .center)
        } else {
            let modelTokensTotal = report.models.reduce(0) { $0 + $1.tokens }
            for (index, model) in report.models.enumerated() {
                drawModelRow(
                    model,
                    index: index,
                    y: m.tokensRowsTop + CGFloat(index) * m.modelRowH,
                    totalTokens: modelTokensTotal
                )
            }
        }

        // 按模型的费用
        draw("COST BY MODEL", x: Self.padding, y: m.costHeaderY + 4, width: 200, font: Font.section, color: .labelColor, alignment: .left)
        for (index, model) in report.models.enumerated() {
            drawModelCostRow(model, index: index, y: m.costRowsTop + CGFloat(index) * m.modelRowH)
        }

        drawHairline(at: m.hairline2Y)

        // 请求
        draw("REQUESTS", x: Self.padding, y: m.requestsY + 3, width: 120, font: Font.caption, color: .secondaryLabelColor, alignment: .left)
        draw(
            "\(formatTokens(totalRequests)) · \(report.keys.count) 个 Key",
            x: Self.padding + 110,
            y: m.requestsY,
            width: Self.inner - 110,
            font: Font.value,
            color: .labelColor,
            alignment: .right
        )

        // 趋势
        draw("COST TREND", x: Self.padding, y: m.trendHeaderY + 4, width: 120, font: Font.section, color: .labelColor, alignment: .left)
        let chartRect = NSRect(x: Self.padding, y: m.chartY, width: Self.inner, height: 56)
        drawTrendChart(in: chartRect)
        if hoveredIndex != nil {
            drawChartTooltip(in: chartRect)
        }
        if let first = report.trend.first, let last = report.trend.last,
           last.time - first.time <= 24 * 3600 {
            drawHourTicks(at: m.axisY)
        } else {
            draw(axisStartLabel(), x: Self.padding, y: m.axisY, width: 120, font: Font.small, color: .tertiaryLabelColor, alignment: .left)
        }
        draw("现在", x: Self.panelWidth - Self.padding - 60, y: m.axisY, width: 60, font: Font.small, color: .tertiaryLabelColor, alignment: .right)

        // 各 Key
        draw("各 Key 用量", x: Self.padding, y: m.keysHeaderY + 4, width: 140, font: Font.section, color: .labelColor, alignment: .left)
        var keysMeta = "\(report.keys.count) 个 Key"
        if let lastUpdated {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            keysMeta += " · \(formatter.string(from: lastUpdated)) 更新"
        }
        draw(keysMeta, x: Self.padding + 140, y: m.keysHeaderY + 5, width: Self.inner - 140, font: Font.small, color: .tertiaryLabelColor, alignment: .right)
        let rowsHeight = max(CGFloat(report.keys.count) * m.keyRowH, 76)
        let pieSize: CGFloat = 76
        let pieRect = NSRect(
            x: Self.panelWidth - Self.padding - pieSize,
            y: m.rowsTop + (rowsHeight - pieSize) / 2,
            width: pieSize,
            height: pieSize
        )
        if report.keys.isEmpty {
            draw("该周期暂无用量数据", x: Self.padding, y: m.rowsTop + rowsHeight / 2 - 8, width: Self.inner, font: Font.small, color: .tertiaryLabelColor, alignment: .center)
        } else {
            for (index, key) in report.keys.enumerated() {
                drawKeyRow(
                    key,
                    index: index,
                    y: m.rowsTop + CGFloat(index) * m.keyRowH,
                    rightEdge: pieRect.minX - 8
                )
            }
            drawKeyPie(in: pieRect)
        }

        // 合计
        drawHairline(at: m.footerHairlineY)
        draw("本周期合计", x: Self.padding, y: m.footerY + 1, width: 90, font: Font.small, color: .secondaryLabelColor, alignment: .left)
        let totalText = "\(formatMoney(totalCost, currency: currency))  ·  \(formatTokens(totalTokens)) Token  ·  \(formatTokens(totalRequests)) 请求"
        draw(totalText, x: Self.padding + 86, y: m.footerY + 1, width: Self.inner - 86, font: Font.small, color: .labelColor, alignment: .right)
    }

    private func drawModelRow(_ model: ModelUsage, index: Int, y: CGFloat, totalTokens: Int) {
        let color = Self.palette[index % Self.palette.count]
        let dotRadius: CGFloat = 3
        let dot = NSBezierPath(
            ovalIn: NSRect(x: Self.padding, y: y + 5, width: dotRadius * 2, height: dotRadius * 2)
        )
        color.setFill()
        dot.fill()

        draw(model.name, x: Self.padding + 14, y: y + 1, width: 190, font: Font.name, color: .labelColor, alignment: .left)
        let share = totalTokens > 0 ? Double(model.tokens) / Double(totalTokens) : 0
        let text = "\(formatTokens(model.tokens)) · \(String(format: "%.1f%%", share * 100))"
        draw(text, x: Self.padding + 200, y: y + 1, width: Self.inner - 200, font: Font.value, color: .secondaryLabelColor, alignment: .right)
    }

    private func drawModelCostRow(_ model: ModelUsage, index: Int, y: CGFloat) {
        let color = Self.palette[index % Self.palette.count]
        let dotRadius: CGFloat = 3
        let dot = NSBezierPath(
            ovalIn: NSRect(x: Self.padding, y: y + 5, width: dotRadius * 2, height: dotRadius * 2)
        )
        color.setFill()
        dot.fill()

        draw(model.name, x: Self.padding + 14, y: y + 1, width: 190, font: Font.name, color: .labelColor, alignment: .left)
        draw(
            formatMoney(model.cost(in: currency), currency: currency),
            x: Self.panelWidth - Self.padding - 92,
            y: y + 1,
            width: 92,
            font: Font.money,
            color: .labelColor,
            alignment: .right
        )
    }

    private func drawKeyRow(_ key: KeyUsage, index: Int, y: CGFloat, rightEdge: CGFloat) {
        let color = Self.palette[index % Self.palette.count]
        let dotRadius: CGFloat = 4

        let dot = NSBezierPath(
            ovalIn: NSRect(x: Self.padding, y: y + 8, width: dotRadius * 2, height: dotRadius * 2)
        )
        color.setFill()
        dot.fill()

        let cost = key.cost(in: currency)
        let costWidth: CGFloat = 92
        let nameX = Self.padding + dotRadius * 2 + 8
        var nameWidth = rightEdge - nameX - costWidth

        // 缓存命中率小标签
        var pillRect: NSRect?
        if let rate = key.cacheHitRate {
            let text = String(format: "%.0f%% 命中", rate * 100)
            let pillWidth = textWidth(text, font: Font.pill) + 10
            nameWidth -= pillWidth + 6
            pillRect = NSRect(x: nameX + nameWidth + 6, y: y + 3, width: pillWidth, height: 15)
        }

        draw(key.name, x: nameX, y: y + 2, width: max(nameWidth, 10), font: Font.name, color: .labelColor, alignment: .left)
        draw(
            formatMoney(cost, currency: currency),
            x: rightEdge - costWidth,
            y: y + 2,
            width: costWidth,
            font: Font.money,
            color: .labelColor,
            alignment: .right
        )

        if let pillRect, let rate = key.cacheHitRate {
            let tint: NSColor = .secondaryLabelColor
            fillRounded(pillRect, radius: pillRect.height / 2, color: tint.withAlphaComponent(0.16))
            draw(
                String(format: "%.0f%% 命中", rate * 100),
                x: pillRect.minX,
                y: pillRect.minY + 1.5,
                width: pillRect.width,
                font: Font.pill,
                color: tint,
                alignment: .center
            )
        }

        let usageText = "\(formatTokens(key.totalTokens)) Token · \(formatTokens(key.requests)) 请求"
        draw(
            usageText,
            x: nameX,
            y: y + 24,
            width: rightEdge - nameX,
            font: Font.value,
            color: .secondaryLabelColor,
            alignment: .left
        )
    }

    private func drawKeyPie(in rect: NSRect) {
        let costs = report.keys.map { $0.cost(in: currency) }
        let useCosts = costs.reduce(0, +) > 0
        let values: [Double] = report.keys.map { key in
            useCosts ? key.cost(in: currency) : Double(key.totalTokens)
        }
        let total = values.reduce(0, +)

        let center = NSPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2 - 8
        let lineWidth: CGFloat = 14

        guard total > 0 else {
            let empty = NSBezierPath(ovalIn: NSRect(
                x: center.x - radius,
                y: center.y - radius,
                width: radius * 2,
                height: radius * 2
            ))
            empty.lineWidth = lineWidth
            NSColor.quaternaryLabelColor.setStroke()
            empty.stroke()
            return
        }

        var startAngle: CGFloat = 90
        for (index, value) in values.enumerated() where value > 0 {
            let sweep = CGFloat(value / total) * 360
            let path = NSBezierPath()
            path.appendArc(
                withCenter: center,
                radius: radius,
                startAngle: startAngle,
                endAngle: startAngle - sweep,
                clockwise: true
            )
            path.lineWidth = lineWidth
            Self.palette[index % Self.palette.count].setStroke()
            path.stroke()
            startAngle -= sweep
        }

        let centerText = useCosts
            ? formatMoney(total, currency: currency)
            : formatTokens(Int(total))
        draw(
            centerText,
            x: rect.minX,
            y: center.y - 8,
            width: rect.width,
            font: Font.value,
            color: .labelColor,
            alignment: .center
        )
    }

    private func drawTrendChart(in rect: NSRect) {
        var values = trendValues()
        if values.allSatisfy({ $0 <= 0 }) {
            let fallback = report.trend.map { Double($0.tokens) }
            if fallback.contains(where: { $0 > 0 }) {
                values = fallback
            }
        }
        guard !values.isEmpty, let maxValue = values.max(), maxValue > 0 else {
            draw("暂无趋势数据", x: rect.minX, y: rect.minY + rect.height / 2 - 8, width: rect.width, font: Font.small, color: .tertiaryLabelColor, alignment: .center)
            return
        }

        let baseline = rect.maxY
        let firstTime = report.trend.first?.time ?? 0
        let lastTime = report.trend.last?.time ?? 0
        let totalSpan = CGFloat(max(lastTime - firstTime, 1))
        let accent = NSColor.controlAccentColor

        for (index, value) in values.enumerated() where value > 0 {
            let height = max(CGFloat(value / maxValue) * (rect.height - 3), 2)
            let x = xPosition(for: report.trend[index].time, in: rect)
            let spacing = CGFloat(spacingForPoint(at: index)) / totalSpan * rect.width
            let barWidth = min(max(spacing * 0.55, 2), 16)
            let barRect = NSRect(
                x: x - barWidth / 2,
                y: baseline - height,
                width: barWidth,
                height: height
            )
            let color = index == hoveredIndex
                ? accent
                : accent.withAlphaComponent(0.5)
            fillRounded(barRect, radius: min(barWidth / 2, 3), color: color)
        }

        // 基线
        NSColor.separatorColor.setFill()
        NSRect(x: rect.minX, y: baseline, width: rect.width, height: 1).fill()
    }

    private func drawChartTooltip(in rect: NSRect) {
        guard let index = hoveredIndex, report.trend.indices.contains(index) else { return }
        let point = report.trend[index]
        let timeText = trendTimeText(at: index)
        let valueText: String
        if Self.trendMode == .cost {
            valueText = formatMoney(point.cost(in: currency), currency: currency)
        } else {
            valueText = "\(formatTokens(point.tokens)) Token"
        }
        let text = "\(timeText)  \(valueText)"
        let attributes: [NSAttributedString.Key: Any] = [.font: Font.value]
        let size = (text as NSString).size(withAttributes: attributes)
        let tooltipWidth = size.width + 14
        let tooltipHeight = size.height + 5
        let slot = rect.width / CGFloat(max(report.trend.count, 1))
        var x = rect.minX + CGFloat(index) * slot + slot / 2 - tooltipWidth / 2
        x = max(rect.minX, min(x, rect.maxX - tooltipWidth))
        let frame = NSRect(x: x, y: rect.minY + 1, width: tooltipWidth, height: tooltipHeight)

        NSColor.windowBackgroundColor.withAlphaComponent(0.96).setFill()
        NSBezierPath(roundedRect: frame, xRadius: 4, yRadius: 4).fill()
        NSColor.separatorColor.setStroke()
        let border = NSBezierPath(roundedRect: frame, xRadius: 4, yRadius: 4)
        border.lineWidth = 0.5
        border.stroke()
        draw(
            text,
            x: frame.minX,
            y: frame.minY + 2.5,
            width: frame.width,
            font: Font.value,
            color: .labelColor,
            alignment: .center
        )
    }

    private func trendTimeText(at index: Int) -> String {
        let time = report.trend[index].time
        let count = report.trend.count
        let spacing: Int
        if index + 1 < count {
            spacing = report.trend[index + 1].time - time
        } else if count > 1 {
            spacing = time - report.trend[index - 1].time
        } else {
            spacing = 3600
        }
        let formatter = DateFormatter()
        formatter.dateFormat = spacing <= 3600 ? "HH:00" : "M/d"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(time)))
    }

    private func xPosition(for time: Int, in rect: NSRect) -> CGFloat {
        guard let first = report.trend.first, let last = report.trend.last,
              last.time > first.time else { return rect.midX }
        let fraction = CGFloat(time - first.time) / CGFloat(last.time - first.time)
        return rect.minX + fraction * rect.width
    }

    private func spacingForPoint(at index: Int) -> Int {
        let count = report.trend.count
        guard count > 1 else { return 3600 }
        let time = report.trend[index].time
        let nextIndex = min(index + 1, count - 1)
        return max(report.trend[nextIndex].time - time, 3600)
    }

    private func drawHourTicks(at y: CGFloat) {
        let count = report.trend.count
        guard count > 1 else { return }
        let slot = Self.inner / CGFloat(count)
        let step = max(count / 4, 1)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH"
        for index in stride(from: 0, to: count, by: step) {
            let x = Self.padding + CGFloat(index) * slot
            if x > Self.inner - 60 { continue }
            let time = report.trend[index].time
            let label = formatter.string(from: Date(timeIntervalSince1970: TimeInterval(time)))
            draw(
                label,
                x: x - 12,
                y: y,
                width: 24,
                font: Font.small,
                color: .tertiaryLabelColor,
                alignment: .center
            )
        }
    }

    // MARK: - Hover tracking

    private func chartRectNow() -> NSRect {
        let m = Self.metrics(
            modelsCount: report.models.count,
            keysCount: report.keys.count,
            hasError: errorMessage != nil
        )
        return NSRect(x: Self.padding, y: m.chartY, width: Self.inner, height: 56)
    }

    private var isLoading: Bool {
        summary == nil && report.keys.isEmpty && errorMessage == nil
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.acceptsMouseMovedEvents = true
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = chartTrackingArea {
            removeTrackingArea(existing)
        }
        let area = NSTrackingArea(
            rect: chartRectNow(),
            options: [.mouseMoved, .mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        chartTrackingArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let rect = chartRectNow()
        guard rect.contains(point), report.trend.count > 1,
              let first = report.trend.first, let last = report.trend.last else {
            if hoveredIndex != nil {
                hoveredIndex = nil
                needsDisplay = true
            }
            return
        }
        let fraction = max(0, min(1, (point.x - rect.minX) / rect.width))
        let target = first.time + Int(CGFloat(last.time - first.time) * fraction)
        let index = report.trend.indices.min(by: {
            abs(report.trend[$0].time - target) < abs(report.trend[$1].time - target)
        })!
        if hoveredIndex != index {
            hoveredIndex = index
            needsDisplay = true
        }
    }

    override func mouseExited(with event: NSEvent) {
        if hoveredIndex != nil {
            hoveredIndex = nil
            needsDisplay = true
        }
    }

    // MARK: - Text helpers

    private func trendValues() -> [Double] {
        switch Self.trendMode {
        case .cost:
            return report.trend.map { $0.cost(in: currency) }
        case .tokens:
            return report.trend.map { Double($0.tokens) }
        }
    }

    private func axisStartLabel() -> String {
        guard let first = report.trend.first, let last = report.trend.last else { return "" }
        let span = Double(last.time - first.time)
        let formatter = DateFormatter()
        formatter.dateFormat = span <= 48 * 3600 ? "HH:mm" : "M/d"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(first.time)))
    }

    private func draw(
        _ text: String,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        font: NSFont,
        color: NSColor,
        alignment: NSTextAlignment
    ) {
        guard !text.isEmpty else { return }
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]
        let lineHeight = ceil(font.ascender - font.descender) + 2
        NSAttributedString(string: text, attributes: attributes).draw(
            with: NSRect(x: x, y: y, width: width, height: lineHeight),
            options: [.usesLineFragmentOrigin]
        )
    }

    private func textWidth(_ text: String, font: NSFont) -> CGFloat {
        (text as NSString).size(withAttributes: [.font: font]).width
    }

    private func fillRounded(_ rect: NSRect, radius: CGFloat, color: NSColor) {
        color.setFill()
        NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
    }

    private func drawHairline(at y: CGFloat) {
        NSColor.separatorColor.setFill()
        NSBezierPath(rect: NSRect(x: Self.padding, y: y, width: Self.inner, height: 1)).fill()
    }
}
