import Foundation

/// 热力图统计指标：按 Token 用量或按消耗（费用）。
enum HeatmapMetric: String, CaseIterable, Identifiable {
    case tokens
    case cost

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tokens: return "Token 用量"
        case .cost: return "消耗（费用）"
        }
    }
}

enum AppSettings {
    private static let defaults = UserDefaults.standard

    static var refreshIntervalMinutes: Int {
        get {
            let value = defaults.integer(forKey: "refreshIntervalMinutes")
            return value <= 0 ? 5 : value
        }
        set { defaults.set(newValue, forKey: "refreshIntervalMinutes") }
    }

    static var period: StatsPeriod {
        get { StatsPeriod(rawValue: defaults.string(forKey: "period") ?? "") ?? .today }
        set { defaults.set(newValue.rawValue, forKey: "period") }
    }

    static var displayCurrency: String {
        get {
            let value = defaults.string(forKey: "displayCurrency") ?? "CNY"
            return (value == "USD" || value == "CNY") ? value : "CNY"
        }
        set { defaults.set(newValue, forKey: "displayCurrency") }
    }

    static var useMockData: Bool {
        get { defaults.bool(forKey: "useMockData") }
        set { defaults.set(newValue, forKey: "useMockData") }
    }

    /// 周期预算上限（跟随显示币种）；<= 0 表示未设置。
    static var budget: Double {
        get { max(0, defaults.double(forKey: "budget")) }
        set { defaults.set(max(0, newValue), forKey: "budget") }
    }

    /// 热力图统计指标。
    static var heatmapMetric: HeatmapMetric {
        get { HeatmapMetric(rawValue: defaults.string(forKey: "heatmapMetric") ?? "") ?? .tokens }
        set { defaults.set(newValue.rawValue, forKey: "heatmapMetric") }
    }

}
