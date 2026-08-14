import Foundation

/// 本地模拟数据：结构与真实接口一致，按小时生成、按天变化，
/// 用于离线测试，避免被平台 WAF 限流干扰。
enum MockData {
    static func fetch(
        window: StatsWindow,
        tz: Int
    ) -> (UserSummary, [APIKeyInfo], UsageAmountData, CostData) {
        let keys = [
            APIKeyInfo(
                createdAt: 1_700_000_000,
                lastUse: nil,
                trackingId: "mock-claude",
                sensitiveId: "sk-mock-1***",
                name: "claude"
            ),
            APIKeyInfo(
                createdAt: 1_700_000_000,
                lastUse: nil,
                trackingId: "mock-codex",
                sensitiveId: "sk-mock-2***",
                name: "codex"
            ),
            APIKeyInfo(
                createdAt: 1_700_000_000,
                lastUse: nil,
                trackingId: "mock-cursor",
                sensitiveId: "sk-mock-3***",
                name: "cursor"
            ),
            APIKeyInfo(
                createdAt: 1_700_000_000,
                lastUse: nil,
                trackingId: "mock-wechat",
                sensitiveId: "sk-mock-4***",
                name: "wechat filter"
            ),
        ]

        let models = [
            "deepseek-chat & deepseek-reasoner",
            "deepseek-v4-flash",
            "deepseek-v4-pro",
        ]

        var amountSeries: [AmountSeries] = []
        var cnySeries: [CostSeries] = []
        var usdSeries: [CostSeries] = []

        for key in keys {
            let keyModels: [String]
            switch key.name {
            case "claude":
                keyModels = ["deepseek-v4-flash", "deepseek-v4-pro"]
            case "codex":
                keyModels = ["deepseek-chat & deepseek-reasoner", "deepseek-v4-pro"]
            case "wechat filter":
                keyModels = ["deepseek-v4-flash"]
            default:
                continue // cursor 不活跃
            }

            for model in keyModels {
                var amountBuckets: [AmountBucket] = []
                var cnyBuckets: [CostBucket] = []
                var usdBuckets: [CostBucket] = []
                var time = window.requestStart
                while time < window.requestEnd {
                    let usage = usage(at: time, keyName: key.name, model: model)
                    amountBuckets.append(AmountBucket(time: time, usage: usage))
                    let usd = costUSD(usage, model: model)
                    cnyBuckets.append(
                        CostBucket(time: time, cost: String(format: "%.10f", usd * 7.2))
                    )
                    usdBuckets.append(
                        CostBucket(time: time, cost: String(format: "%.10f", usd))
                    )
                    time += 3600
                }

                let seriesKey = SeriesKey(
                    trackingId: key.trackingId,
                    name: key.name,
                    sensitiveId: key.sensitiveId,
                    valid: true
                )
                amountSeries.append(
                    AmountSeries(apiKey: seriesKey, model: model, buckets: amountBuckets)
                )
                cnySeries.append(CostSeries(apiKey: seriesKey, model: model, buckets: cnyBuckets))
                usdSeries.append(CostSeries(apiKey: seriesKey, model: model, buckets: usdBuckets))
            }
        }

        let amount = UsageAmountData(
            start: window.requestStart,
            end: window.requestEnd,
            bucket: 3600,
            models: models,
            series: amountSeries
        )
        let cost = CostData(
            start: window.requestStart,
            end: window.requestEnd,
            bucket: 3600,
            models: models,
            data: [
                CurrencyCostSeries(currency: "CNY", series: cnySeries),
                CurrencyCostSeries(currency: "USD", series: usdSeries),
            ]
        )
        let summary = UserSummary(
            normalWallets: [
                Wallet(currency: "USD", balance: "8.4200000000", tokenEstimation: "0"),
                Wallet(currency: "CNY", balance: "3.1400000000", tokenEstimation: "0"),
            ],
            bonusWallets: [
                Wallet(currency: "USD", balance: "0", tokenEstimation: "0"),
            ],
            totalCosts: [
                CostTotal(currency: "USD", amount: "0.8800000000"),
                CostTotal(currency: "CNY", amount: "1.2300000000"),
            ]
        )
        return (summary, keys, amount, cost)
    }

    private static func usage(at time: Int, keyName: String, model: String) -> TokenUsage {
        let hour = (time % 86400) / 3600
        let busy = (hour >= 9 && hour <= 22) ? 1.0 : 0.2
        let keyFactor = keyName == "wechat filter" ? 0.04 : 1.0
        let modelFactor = model == "deepseek-v4-pro" ? 2.0 : 1.0
        let base = Int(2_000_000 * busy * keyFactor * modelFactor)
        let salt = keyName.hashValue

        let hit = rand(time, salt: salt &+ 1, scale: base)
        let miss = rand(time, salt: salt &+ 2, scale: max(base / 8, 500))
        let response = rand(time, salt: salt &+ 3, scale: max(base / 20, 100))
        let requests = rand(time, salt: salt &+ 4, scale: max(base / 6000, 1))

        return TokenUsage(
            request: requests,
            responseToken: response,
            promptCacheHitToken: hit,
            promptCacheMissToken: miss
        )
    }

    private static func costUSD(_ usage: TokenUsage, model: String) -> Double {
        let hit = Double(usage.promptCacheHitToken ?? 0)
        let miss = Double(usage.promptCacheMissToken ?? 0)
        let output = Double(usage.responseToken ?? 0)
        let prices: (hit: Double, miss: Double, output: Double)
        if model == "deepseek-v4-pro" {
            prices = (0.025, 3.0, 6.0)
        } else {
            prices = (0.02, 1.0, 2.0)
        }
        return (hit * prices.hit + miss * prices.miss + output * prices.output) / 1_000_000
    }

    /// 确定性伪随机，保证同一小时的值稳定。
    private static func rand(_ time: Int, salt: Int, scale: Int) -> Int {
        var x = UInt64(truncatingIfNeeded: Int64(time)) &* 0x9E37_79B9_7F4A_7C15
        x = x &+ UInt64(truncatingIfNeeded: Int64(salt))
        x ^= x >> 30
        x = x &* 0xBF58_476D_1CE4_E5B9
        x ^= x >> 27
        x = x &* 0x94D0_49BB_1331_11EB
        x ^= x >> 31
        return Int(x % UInt64(max(scale, 1)))
    }
}
