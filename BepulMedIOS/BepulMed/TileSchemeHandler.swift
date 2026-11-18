import Foundation
import Network
import WebKit

/// Офлайн-кэш тайлов OpenStreetMap для iOS: bmtile://osm/{z}/{x}/{y}.png.
/// Сохраняем только то, что пользователь сам просмотрел (массовая загрузка запрещена правилами OSM).
/// Без сети — сохранённый тайл; со связью — обновляем тайлы старше 7 дней. Лимит 120 МБ.
final class TileSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "bmtile"
    private static let maxAge: TimeInterval = 7 * 24 * 3600
    private static let maxBytes = 120 * 1024 * 1024
    private let dir: URL
    private let session: URLSession
    private let monitor = NWPathMonitor()
    private(set) var online = true
    private var stopped = Set<ObjectIdentifier>()
    private var writes = 0
    var onChange: (() -> Void)?

    override init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        dir = caches.appendingPathComponent("tiles", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let cfg = URLSessionConfiguration.default
        cfg.httpAdditionalHeaders = ["User-Agent": "BepulMedAI/\(WebViewController.version) (iOS; offline tile cache)"]
        cfg.timeoutIntervalForRequest = 10
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: cfg)
        super.init()
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async { self?.online = path.status == .satisfied; self?.onChange?() }
        }
        monitor.start(queue: DispatchQueue(label: "bm.net"))
    }

    /// z/x/y из пути "/z/x/y.png" с проверкой диапазонов.
    static func parse(_ path: String) -> (Int, Int, Int)? {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 3, parts[2].hasSuffix(".png"),
              let z = Int(parts[0]), let x = Int(parts[1]), let y = Int(parts[2].dropLast(4)),
              (0...19).contains(z), x >= 0, y >= 0, x < (1 << z), y < (1 << z) else { return nil }
        return (z, x, y)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let zxy = TileSchemeHandler.parse(url.path) else {
            return finish(task, url: task.request.url, data: nil)
        }
        let (z, x, y) = zxy
        let file = dir.appendingPathComponent("\(z)_\(x)_\(y).png")
        let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
        let modified = attrs?[.modificationDate] as? Date
        let fresh = modified.map { Date().timeIntervalSince($0) < TileSchemeHandler.maxAge } ?? false
        if modified != nil && (fresh || !online) {
            return finish(task, url: url, data: try? Data(contentsOf: file))
        }
        if !online { return finish(task, url: url, data: nil) }
        let remote = URL(string: "https://tile.openstreetmap.org/\(z)/\(x)/\(y).png")!
        session.dataTask(with: remote) { [weak self] data, resp, _ in
            guard let self = self else { return }
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200 && (data?.count ?? 0) > 0 && (data?.count ?? 0) < 512 * 1024
            if ok, let d = data { try? d.write(to: file, options: .atomic) }
            let body = ok ? data : (modified != nil ? try? Data(contentsOf: file) : nil)
            DispatchQueue.main.async {
                self.finish(task, url: url, data: body)
                if ok { self.didWrite() }
            }
        }.resume()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func finish(_ task: WKURLSchemeTask, url: URL?, data: Data?) {
        if stopped.remove(ObjectIdentifier(task)) != nil { return }
        let u = url ?? URL(string: "\(TileSchemeHandler.scheme)://osm/")!
        let headers = ["Content-Type": "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400"]
        let resp = HTTPURLResponse(url: u, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        if let d = data { task.didReceive(d) }
        task.didFinish()
    }

    private func didWrite() {
        writes += 1
        if writes % 25 == 0 { onChange?() }
        if writes % 200 == 0 { DispatchQueue.global(qos: .utility).async { self.prune() } }
    }

    private func files() -> [(URL, Int, Date)] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        let list = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []
        return list.filter { $0.pathExtension == "png" }.map { u in
            let v = try? u.resourceValues(forKeys: Set(keys))
            return (u, v?.fileSize ?? 0, v?.contentModificationDate ?? .distantPast)
        }
    }

    func prune() {
        var all = files()
        var total = all.reduce(0) { $0 + $1.1 }
        guard total > TileSchemeHandler.maxBytes else { return }
        all.sort { $0.2 < $1.2 }
        for f in all where total > TileSchemeHandler.maxBytes * 8 / 10 {
            try? FileManager.default.removeItem(at: f.0)
            total -= f.1
        }
    }

    func stats() -> (count: Int, bytes: Int) {
        let all = files()
        return (all.count, all.reduce(0) { $0 + $1.1 })
    }

    func clear() {
        for f in files() { try? FileManager.default.removeItem(at: f.0) }
    }
}
