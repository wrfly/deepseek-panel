import Foundation

enum APIError: Error {
    case network
    case http(Int)
    case unauthorized
    case server(String)
    case decode(String)
}

struct Envelope<T: Decodable>: Decodable {
    struct Payload: Decodable {
        let bizCode: Int
        let bizMsg: String?
        let bizData: T?
    }

    let code: Int
    let msg: String?
    let data: Payload?
}

final class DeepSeekClient {
    private let token: String
    private let base = URL(string: "https://platform.deepseek.com/api/v0")!

    init(token: String) {
        self.token = token
    }

    func fetchSummary() async throws -> UserSummary {
        try await get("users/get_user_summary")
    }

    func fetchKeys() async throws -> [APIKeyInfo] {
        let list: APIKeyList = try await get("users/get_api_keys")
        return list.apiKeys
    }

    func fetchAmount(start: Int, end: Int, tz: Int) async throws -> UsageAmountData {
        try await get(
            "usage/by_api_key/amount",
            query: [
                URLQueryItem(name: "start", value: String(start)),
                URLQueryItem(name: "end", value: String(end)),
                URLQueryItem(name: "tz", value: String(tz))
            ]
        )
    }

    func fetchCost(start: Int, end: Int, tz: Int) async throws -> CostData {
        try await get(
            "usage/by_api_key/cost",
            query: [
                URLQueryItem(name: "start", value: String(start)),
                URLQueryItem(name: "end", value: String(end)),
                URLQueryItem(name: "tz", value: String(tz))
            ]
        )
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var components = URLComponents(
            url: base.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = query.isEmpty ? nil : query
        guard let url = components?.url else { throw APIError.network }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
            forHTTPHeaderField: "user-agent"
        )
        request.setValue("web", forHTTPHeaderField: "x-client-platform")
        request.setValue("https://platform.deepseek.com/usage", forHTTPHeaderField: "referer")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.network
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard http.statusCode == 200 else {
            if http.statusCode == 401 || http.statusCode == 403 {
                throw APIError.unauthorized
            }
            throw APIError.http(http.statusCode)
        }

        do {
            let envelope = try Self.decoder.decode(Envelope<T>.self, from: data)
            guard envelope.code == 0 else {
                throw APIError.server(envelope.msg ?? "unknown")
            }
            guard let payload = envelope.data else {
                throw APIError.decode("empty payload")
            }
            guard payload.bizCode == 0 else {
                throw APIError.server(payload.bizMsg ?? "unknown")
            }
            guard let bizData = payload.bizData else {
                throw APIError.decode("empty biz_data")
            }
            return bizData
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.decode(String(describing: error))
        }
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}
