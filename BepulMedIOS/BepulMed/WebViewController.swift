import UIKit
import WebKit

/// Экран приложения: интерфейс BepulMed (React) лежит внутри приложения и раздаётся по схеме bepulmed://app/.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let version = "2.13"
    static let startURL = URL(string: "\(AssetSchemeHandler.scheme)://app/index.html")!

    private var webView: WKWebView!
    private let assets = AssetSchemeHandler()
    private let tiles = TileSchemeHandler()
    private var bridge: NativeBridge!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(assets, forURLScheme: AssetSchemeHandler.scheme)
        config.setURLSchemeHandler(tiles, forURLScheme: TileSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "BepulMedIOS/\(WebViewController.version) Mobile/15E148 Safari/604.1"
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        bridge = NativeBridge(tiles: tiles)
        let content = config.userContentController
        content.add(WeakScriptHandler(bridge), name: "bm")
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"), let js = try? String(contentsOf: url, encoding: .utf8) {
            let source = js.replacingOccurrences(of: "__BM_CAPS__", with: bridge.capabilitiesJSON())
            content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        bridge.webView = webView

        let root = UIView()
        root.backgroundColor = .systemBackground
        root.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: WebViewController.startURL))
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func becameActive() { bridge.pushCapabilities() }

    // Ссылки: tel:, sms:, карты, Telegram и любые внешние сайты — в системные приложения.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        if scheme == AssetSchemeHandler.scheme || scheme == TileSchemeHandler.scheme || scheme == "about" || scheme == "blob" || scheme == "data" {
            return decisionHandler(.allow)
        }
        if navigationAction.targetFrame?.isMainFrame == false && (scheme == "https" || scheme == "http") {
            return decisionHandler(.allow) // встроенный фрейм (не используется), не уводим из приложения
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        decisionHandler(.cancel)
    }

    // target="_blank" / window.open → системный браузер или приложение.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
        return nil
    }

    // Разрешение на микрофон/камеру для страницы (getUserMedia) — только нашему интерфейсу.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == AssetSchemeHandler.scheme ? .prompt : .deny)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: WebViewController.startURL))
    }

    // alert/confirm (на всякий случай: интерфейс их не использует).
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
}

/// WKUserContentController держит обработчик сильной ссылкой — разрываем цикл.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(c, didReceive: message)
    }
}
