import Foundation

enum Dump {
    static func run() async {
        let useMock = ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_MOCK"] == "1"
            || AppSettings.useMockData
        let token = Keychain.load() ?? AppDefaults.initialToken
        let client = DeepSeekClient(token: token)
        let period = AppSettings.period
        let now = Date()
        let window = period.window(now: now)
        let tz = TimeZone.current.secondsFromGMT(for: now)

        do {
            let summary: UserSummary
            let keys: [APIKeyInfo]
            let amount: UsageAmountData
            let cost: CostData
            if useMock {
                (summary, keys, amount, cost) = MockData.fetch(window: window, tz: tz)
            } else {
                summary = try await client.fetchSummary()
                keys = try await client.fetchKeys()
                amount = try await client.fetchAmount(
                    start: window.requestStart,
                    end: window.requestEnd,
                    tz: tz
                )
                cost = try await client.fetchCost(
                    start: window.requestStart,
                    end: window.requestEnd,
                    tz: tz
                )
            }
            let report = UsageAggregator.build(
                keys: keys,
                amount: amount,
                cost: cost,
                window: window
            )

            print("=== 余额 ===")
            for wallet in summary.normalWallets {
                print("充值 \(wallet.currency): \(wallet.balance)")
            }
            for wallet in summary.bonusWallets {
                print("赠送 \(wallet.currency): \(wallet.balance)")
            }
            for total in summary.totalCosts {
                print("累计消耗 \(total.currency): \(total.amount)")
            }
            print("=== API Keys ===")
            for key in keys {
                print("- \(key.name)")
            }
            print("=== 用量（\(period.title)）===")
            for usage in report.keys {
                let inputTotal = usage.promptCacheHitTokens + usage.promptCacheMissTokens
                print(
                    "- \(usage.name): 请求数=\(usage.requests) " +
                    "输入总量=\(formatTokens(inputTotal)) 命中率=\(formatRate(usage.cacheHitRate)) " +
                    "输出=\(usage.responseTokens) " +
                    "费用CNY=\(usage.costCNY) 费用USD=\(usage.costUSD)"
                )
            }
            print("=== 模型 ===")
            for model in report.models {
                print("- \(model.name): tokens=\(model.tokens) cny=\(model.costCNY) usd=\(model.costUSD)")
            }
            print("=== 趋势（\(report.trend.count) 个点）===")
            for point in report.trend {
                print("- \(point.time): tokens=\(point.tokens) cny=\(point.costCNY) usd=\(point.costUSD)")
            }
            print("DUMP_OK")
        } catch {
            print("DUMP_ERROR: \(error)")
        }
    }
}
