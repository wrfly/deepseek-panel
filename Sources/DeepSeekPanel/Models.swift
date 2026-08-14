import Foundation

struct Wallet: Decodable {
    let currency: String
    let balance: String
    let tokenEstimation: String?
}

struct CostTotal: Decodable {
    let currency: String
    let amount: String
}

struct UserSummary: Decodable {
    let normalWallets: [Wallet]
    let bonusWallets: [Wallet]
    let totalCosts: [CostTotal]
}

struct APIKeyInfo: Decodable {
    let createdAt: Int?
    let lastUse: Int?
    let trackingId: String
    let sensitiveId: String
    let name: String
}

struct APIKeyList: Decodable {
    let apiKeys: [APIKeyInfo]
}

struct SeriesKey: Decodable {
    let trackingId: String
    let name: String
    let sensitiveId: String
    let valid: Bool?
}

struct TokenUsage: Decodable {
    let request: Int?
    let responseToken: Int?
    let promptCacheHitToken: Int?
    let promptCacheMissToken: Int?

    // 注意：JSONDecoder 的 convertFromSnakeCase 会先转换 JSON 键，
    // 再与 CodingKeys 的原始值比较，因此这里要写转换后的形态。
    private enum CodingKeys: String, CodingKey {
        case request = "REQUEST"
        case responseToken = "responseToken"
        case promptCacheHitToken = "promptCacheHitToken"
        case promptCacheMissToken = "promptCacheMissToken"
    }
}

struct AmountBucket: Decodable {
    let time: Int
    let usage: TokenUsage
}

struct AmountSeries: Decodable {
    let apiKey: SeriesKey
    let model: String
    let buckets: [AmountBucket]
}

struct UsageAmountData: Decodable {
    let start: Int
    let end: Int
    let bucket: Int
    let models: [String]?
    let series: [AmountSeries]
}

struct CostBucket: Decodable {
    let time: Int
    let cost: String
}

struct CostSeries: Decodable {
    let apiKey: SeriesKey
    let model: String
    let buckets: [CostBucket]
}

struct CurrencyCostSeries: Decodable {
    let currency: String
    let series: [CostSeries]
}

struct CostData: Decodable {
    let start: Int
    let end: Int
    let bucket: Int
    let models: [String]?
    let data: [CurrencyCostSeries]?
}
