import Foundation

/// 趋势数据的本地持久化：按小时合并累积，重启后不丢失。
enum TrendStore {
    private static var fileURL: URL {
        let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        let directory = base.appendingPathComponent("DeepSeekPanel", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory.appendingPathComponent("trend.json")
    }

    static func load() -> [Int: TrendPoint] {
        guard let data = try? Data(contentsOf: fileURL),
              let points = try? JSONDecoder().decode([TrendPoint].self, from: data) else {
            return [:]
        }
        return Dictionary(uniqueKeysWithValues: points.map { ($0.time, $0) })
    }

    static func save(_ points: [TrendPoint]) {
        let sorted = points.sorted { $0.time < $1.time }
        guard let data = try? JSONEncoder().encode(sorted) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// 用最新拉取的数据覆盖合并，并按小时去重；只保留最近 400 天。
    static func merge(_ existing: [Int: TrendPoint], _ fetched: [TrendPoint]) -> [TrendPoint] {
        var merged = existing
        for point in fetched {
            merged[point.time] = point
        }
        var sorted = merged.values.sorted { $0.time < $1.time }
        let maxPoints = 24 * 400
        if sorted.count > maxPoints {
            sorted = Array(sorted.suffix(maxPoints))
        }
        return sorted
    }

    /// 某一天内已缓存的小时数。
    static func coverageCount(from start: Int, to end: Int) -> Int {
        load().values.reduce(0) { count, point in
            point.time >= start && point.time < end ? count + 1 : count
        }
    }

    /// 用新数据整体替换某一天的小时数据（幂等，重复拉取不会叠加）。
    static func replaceDay(_ points: [TrendPoint], dayStart: Int, dayEnd: Int) {
        var all = load().values.filter { $0.time < dayStart || $0.time >= dayEnd }
        all.append(contentsOf: points)
        save(all)
    }
}
