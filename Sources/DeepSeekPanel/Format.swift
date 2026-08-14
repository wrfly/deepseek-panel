import Foundation

func parseDecimal(_ string: String) -> Double {
    Double(string) ?? 0
}

func formatMoney(_ value: Double, currency: String) -> String {
    let symbol = currency == "USD" ? "$" : "¥"
    return symbol + String(format: "%.2f", value)
}

func formatTokens(_ count: Int) -> String {
    if count >= 1_000_000 {
        return String(format: "%.2fM", Double(count) / 1_000_000)
    }
    if count >= 1_000 {
        return String(format: "%.0fk", Double(count) / 1_000)
    }
    return String(count)
}

func formatRate(_ rate: Double?) -> String {
    guard let rate else { return "—" }
    return String(format: "%.1f%%", rate * 100)
}
