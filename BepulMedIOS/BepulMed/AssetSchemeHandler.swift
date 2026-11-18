import Foundation
import WebKit

/// Раздаёт собранный интерфейс из папки www внутри приложения: bepulmed://app/<путь>.
/// Всё локально — интерфейс, OCR-модели, данные Ташкента работают без интернета.
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "bepulmed"
    private let root: URL? = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true)
    private var stopped = Set<ObjectIdentifier>()
    private let io = DispatchQueue(label: "bm.assets", qos: .userInitiated, attributes: .concurrent)

    static func assetPath(_ raw: String) -> String? {
        var p = raw.removingPercentEncoding ?? raw
        while p.hasPrefix("/") { p.removeFirst() }
        if p.contains("..") || p.contains("\\") { return nil } // за пределы www не выходим
        if p.isEmpty { return "index.html" }
        let last = p.split(separator: "/").last.map(String.init) ?? ""
        return last.contains(".") ? p : "index.html"
    }

    static func mime(_ path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "wasm": return "application/wasm"
        case "woff2": return "font/woff2"
        case "gz": return "application/gzip"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let id = ObjectIdentifier(task)
        let isHead = task.request.httpMethod == "HEAD"
        let range = task.request.value(forHTTPHeaderField: "Range")
        io.async { [weak self] in
            guard let self = self else { return }
            var status = 404
            var data = Data()
            var type = "text/plain; charset=utf-8"
            var extra: [String: String] = [:]
            if let root = self.root, let path = AssetSchemeHandler.assetPath(url.path) {
                let file = root.appendingPathComponent(path)
                if let r = range, path.hasSuffix(".pmtiles"), let part = AssetSchemeHandler.readRange(file, r) {
                    // Офлайн-карта читается кусками (HTTP Range → 206)
                    status = part.status
                    data = part.data
                    type = "application/octet-stream"
                    extra = part.headers
                } else if let d = try? Data(contentsOf: file, options: .mappedIfSafe) {
                    status = 200
                    data = d
                    type = AssetSchemeHandler.mime(path)
                }
            }
            DispatchQueue.main.async {
                if self.stopped.remove(id) != nil { return }
                var headers = ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"]
                for (k, v) in extra { headers[k] = v }
                guard let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
                    return task.didFailWithError(URLError(.cannotParseResponse))
                }
                task.didReceive(resp)
                if !isHead && !data.isEmpty { task.didReceive(data) }
                task.didFinish()
            }
        }
    }

    /** bytes=a-b из файла без чтения целиком. */
    static func readRange(_ file: URL, _ header: String) -> (status: Int, data: Data, headers: [String: String])? {
        let h = header.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("bytes="), let fh = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? fh.close() }
        let parts = h.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, let start = UInt64(parts[0]),
              let attrs = try? FileManager.default.attributesOfItem(atPath: file.path), let size = (attrs[.size] as? NSNumber)?.uint64Value else { return nil }
        let end = parts[1].isEmpty ? size - 1 : min(UInt64(parts[1]) ?? (size - 1), size - 1)
        if start >= size || end < start { return (416, Data(), ["Content-Range": "bytes */\(size)"]) }
        do {
            try fh.seek(toOffset: start)
            let d = try fh.read(upToCount: Int(min(end - start + 1, 8 * 1024 * 1024))) ?? Data()
            return (206, d, ["Content-Range": "bytes \(start)-\(start + UInt64(d.count) - 1)/\(size)", "Accept-Ranges": "bytes"])
        } catch {
            return nil
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }
}
