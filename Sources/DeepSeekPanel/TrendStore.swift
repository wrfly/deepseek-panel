import Foundation

/// 趋势数据的本地持久化：按小时合并累积，重启后不丢失。
/// 同时维护一份内存缓存，避免一次刷新内反复读写磁盘。
enum TrendStore {
    private static var cache: [Int: TrendPoint]?

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
        if let cache { return cache }
        let loaded = loadFromDisk()
        cache = loaded
        return loaded
    }

    private static func loadFromDisk() -> [Int: TrendPoint] {
        guard let data = try? Data(contentsOf: fileURL),
              let points = try? JSONDecoder().decode([TrendPoint].self, from: data) else {
            return [:]
        }
        return Dictionary(uniqueKeysWithValues: points.map { ($0.time, $0) })
    }

    static func save(_ points: [TrendPoint]) {
        let sorted = points.sorted { $0.time < $1.time }
        cache = Dictionary(uniqueKeysWithValues: sorted.map { ($0.time, $0) })
        guard let data = try? JSONEncoder().encode(sorted) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// 某一天内已缓存的小时数。
    static func coverageCount(from start: Int, to end: Int) -> Int {
        load().values.reduce(0) { count, point in
            point.time >= start && point.time < end ? count + 1 : count
        }
    }

    /// 用新数据整体替换某一天的小时数据（幂等，重复拉取不会叠加）。
    static func replaceDay(_ points: [TrendPoint], dayStart: Int, dayEnd: Int) {
        replaceRange(points, start: dayStart, end: dayEnd)
    }

    /// 用新数据整体替换 [start, end) 范围内的小时数据（可跨多天，幂等）。
    static func replaceRange(_ points: [TrendPoint], start: Int, end: Int) {
        var all = load().values.filter { $0.time < start || $0.time >= end }
        all.append(contentsOf: points)
        save(all)
    }
}
