import Foundation

func parseDecimal(_ string: String) -> Double {
    Double(string) ?? 0
}

func formatMoney(_ value: Double, currency: String) -> String {
    let symbol = currency == "USD" ? "$" : "¥"
    // 极小费用（< 0.01）用 4 位小数，避免被抹成 0.00；常规金额保持 2 位。
    let decimals = (value != 0 && abs(value) < 0.01) ? 4 : 2
    return symbol + String(format: "%.\(decimals)f", value)
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
