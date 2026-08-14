import Foundation

enum StatsPeriod: String, CaseIterable, Identifiable {
    case today
    case last24h = "last24h"
    case last7d = "last7d"
    case thisMonth = "thisMonth"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: return "今天"
        case .last24h: return "最近 24 小时"
        case .last7d: return "最近 7 天"
        case .thisMonth: return "本月"
        }
    }

    func window(now: Date = Date(), calendar: Calendar = .current) -> StatsWindow {
        let end = Int(now.timeIntervalSince1970)
        var start = end - 86400

        switch self {
        case .today:
            start = Int(calendar.startOfDay(for: now).timeIntervalSince1970)
        case .last24h:
            start = end - 86400
        case .last7d:
            start = end - 7 * 86400
        case .thisMonth:
            let components = calendar.dateComponents([.year, .month], from: now)
            if let date = calendar.date(from: components) {
                start = Int(date.timeIntervalSince1970)
            }
        }

        let hour = 3600
        let filterStart = (start / hour) * hour
        let filterEnd = ((end + hour - 1) / hour) * hour

        let requestStartDate = calendar.startOfDay(
            for: Date(timeIntervalSince1970: TimeInterval(filterStart))
        )
        let requestStart = Int(requestStartDate.timeIntervalSince1970)

        let dayStart = calendar.startOfDay(for: now)
        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
            return StatsWindow(
                filterStart: filterStart,
                filterEnd: filterEnd,
                requestStart: requestStart,
                requestEnd: filterEnd
            )
        }
        let requestEnd = Int(tomorrow.timeIntervalSince1970)

        return StatsWindow(
            filterStart: filterStart,
            filterEnd: filterEnd,
            requestStart: requestStart,
            requestEnd: requestEnd
        )
    }
}

struct StatsWindow {
    let filterStart: Int
    let filterEnd: Int
    let requestStart: Int
    let requestEnd: Int

    func contains(time: Int) -> Bool {
        time >= filterStart && time < filterEnd
    }
}

struct KeyUsage {
    let name: String
    let trackingId: String
    var requests = 0
    var responseTokens = 0
    var promptCacheHitTokens = 0
    var promptCacheMissTokens = 0
    var costCNY = 0.0
    var costUSD = 0.0

    var totalTokens: Int {
        responseTokens + promptCacheHitTokens + promptCacheMissTokens
    }

    var cacheHitRate: Double? {
        let denominator = promptCacheHitTokens + promptCacheMissTokens
        guard denominator > 0 else { return nil }
        return Double(promptCacheHitTokens) / Double(denominator)
    }

    func cost(in currency: String) -> Double {
        currency == "USD" ? costUSD : costCNY
    }
}

/// 单个时间点上的聚合用量（跨所有 Key），用于绘制趋势图。
struct TrendPoint: Codable {
    let time: Int
    var tokens = 0
    var costCNY = 0.0
    var costUSD = 0.0

    func cost(in currency: String) -> Double {
        currency == "USD" ? costUSD : costCNY
    }
}

/// 单个模型的聚合用量，用于「按模型」拆分的列表。
struct ModelUsage {
    let name: String
    var tokens = 0
    var costCNY = 0.0
    var costUSD = 0.0

    func cost(in currency: String) -> Double {
        currency == "USD" ? costUSD : costCNY
    }
}

/// 一次聚合的完整结果：各 Key 的用量排行 + 随时间变化的趋势。
struct UsageReport {
    var keys: [KeyUsage] = []
    var models: [ModelUsage] = []
    var trend: [TrendPoint] = []
}

enum UsageAggregator {
    static func build(
        keys: [APIKeyInfo],
        amount: UsageAmountData,
        cost: CostData,
        window: StatsWindow,
        currency: String
    ) -> UsageReport {
        var byName: [String: KeyUsage] = [:]
        var modelByName: [String: ModelUsage] = [:]
        var trendByTime: [Int: TrendPoint] = [:]

        for key in keys {
            byName[key.name] = KeyUsage(name: key.name, trackingId: key.trackingId)
        }

        for series in amount.series {
            var usage = byName[series.apiKey.name]
                ?? KeyUsage(name: series.apiKey.name, trackingId: series.apiKey.trackingId)
            for bucket in series.buckets where window.contains(time: bucket.time) {
                usage.requests += bucket.usage.request ?? 0
                usage.responseTokens += bucket.usage.responseToken ?? 0
                usage.promptCacheHitTokens += bucket.usage.promptCacheHitToken ?? 0
                usage.promptCacheMissTokens += bucket.usage.promptCacheMissToken ?? 0

                var point = trendByTime[bucket.time] ?? TrendPoint(time: bucket.time)
                let bucketTokens = (bucket.usage.responseToken ?? 0)
                    + (bucket.usage.promptCacheHitToken ?? 0)
                    + (bucket.usage.promptCacheMissToken ?? 0)
                point.tokens += bucketTokens
                trendByTime[bucket.time] = point

                var model = modelByName[series.model] ?? ModelUsage(name: series.model)
                model.tokens += bucketTokens
                modelByName[series.model] = model
            }
            byName[series.apiKey.name] = usage
        }

        for currency in cost.data ?? [] {
            let isUSD = currency.currency == "USD"
            for series in currency.series {
                var usage = byName[series.apiKey.name]
                    ?? KeyUsage(name: series.apiKey.name, trackingId: series.apiKey.trackingId)
                for bucket in series.buckets where window.contains(time: bucket.time) {
                    let value = Double(bucket.cost) ?? 0
                    if isUSD {
                        usage.costUSD += value
                    } else {
                        usage.costCNY += value
                    }

                    var point = trendByTime[bucket.time] ?? TrendPoint(time: bucket.time)
                    if isUSD {
                        point.costUSD += value
                    } else {
                        point.costCNY += value
                    }
                    trendByTime[bucket.time] = point

                    var model = modelByName[series.model] ?? ModelUsage(name: series.model)
                    if isUSD {
                        model.costUSD += value
                    } else {
                        model.costCNY += value
                    }
                    modelByName[series.model] = model
                }
                byName[series.apiKey.name] = usage
            }
        }

        let sortedKeys = byName.values
            .filter { key in
                key.requests > 0 || key.totalTokens > 0 || key.costCNY > 0 || key.costUSD > 0
            }
            .sorted { left, right in
                let leftCost = left.cost(in: currency)
                let rightCost = right.cost(in: currency)
                if leftCost != rightCost {
                    return leftCost > rightCost
                }
                return left.name.localizedStandardCompare(right.name) == .orderedAscending
            }
        let models = modelByName.values
            .filter { $0.tokens > 0 || $0.costCNY > 0 || $0.costUSD > 0 }
            .sorted { left, right in
                if left.tokens != right.tokens {
                    return left.tokens > right.tokens
                }
                return left.name.localizedStandardCompare(right.name) == .orderedAscending
            }
        let trend = trendByTime.values.sorted { $0.time < $1.time }
        return UsageReport(keys: sortedKeys, models: models, trend: trend)
    }
}
