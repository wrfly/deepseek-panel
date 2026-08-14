import Foundation

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

}
