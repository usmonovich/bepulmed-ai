import AuthenticationServices
import AVFoundation
import CoreLocation
import Speech
import UIKit
import WebKit

/// Нативные функции для интерфейса (как VoiceBridge в Android-версии):
/// распознавание речи (по умолчанию только на устройстве), озвучка, геокодер, геолокация, кэш карты.
/// Сообщения принимаются только от нашей страницы bepulmed://app в главном фрейме.
final class NativeBridge: NSObject, WKScriptMessageHandler, AVSpeechSynthesizerDelegate, CLLocationManagerDelegate, ASWebAuthenticationPresentationContextProviding {
    weak var webView: WKWebView?
    private let tiles: TileSchemeHandler
    private let defaults = UserDefaults.standard
    private var allowNetworkSpeech: Bool { defaults.bool(forKey: "net_speech") }

    // Речь
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var session = 0
    private var lastText = ""
    private var delivered = false
    private var silenceTimer: Timer?
    private var limitTimer: Timer?
    private let synth = AVSpeechSynthesizer()

    // Геокодер (по одному запросу, Apple ограничивает частоту)
    private let geocoder = CLGeocoder()
    private var geoQueue: [(String, String)] = []
    private var geoBusy = false

    // Геолокация
    private let location = CLLocationManager()
    private var pendingLocation: [Int] = []
    private var watches = Set<Int>()

    // DMED
    static let authScheme = "uz.bepulmed.app"
    private var authSession: ASWebAuthenticationSession?
    private let http: URLSession = {
        let c = URLSessionConfiguration.ephemeral // без cookies и кэша: токены и данные не пишутся на диск
        c.timeoutIntervalForRequest = 15
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        c.httpCookieStorage = nil
        return URLSession(configuration: c)
    }()

    init(tiles: TileSchemeHandler) {
        self.tiles = tiles
        super.init()
        synth.delegate = self
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        tiles.onChange = { [weak self] in self?.pushCapabilities() }
    }

    // MARK: - Возможности

    private func recognizer(_ lang: String) -> SFSpeechRecognizer? {
        // Узбекский распознаватель Apple может отсутствовать — тогда русский (как и озвучка в Android).
        if lang.hasPrefix("uz") {
            let uz = SFSpeechRecognizer.supportedLocales().contains { $0.identifier.hasPrefix("uz") }
            if uz, let r = SFSpeechRecognizer(locale: Locale(identifier: "uz-UZ")) { return r }
        }
        return SFSpeechRecognizer(locale: Locale(identifier: "ru-RU"))
    }

    func capabilities() -> [String: Any] {
        let r = recognizer("ru-RU")
        let onDevice = r?.supportsOnDeviceRecognition ?? false
        let network = r != nil
        let t = tiles.stats()
        return [
            "platform": "ios",
            "sttOnDevice": onDevice,
            "sttNetwork": network,
            "netSpeechAllowed": allowNetworkSpeech,
            "stt": onDevice || (allowNetworkSpeech && network),
            "tts": true,
            "ttsUz": AVSpeechSynthesisVoice(language: "uz-UZ") != nil,
            "geo": true,
            "online": tiles.online,
            "tiles": t.count,
            "tileBytes": t.bytes,
        ]
    }

    func capabilitiesJSON() -> String { json(capabilities()) }

    func pushCapabilities() {
        DispatchQueue.global(qos: .utility).async {
            let c = self.capabilitiesJSON()
            DispatchQueue.main.async { self.js("window.__bmCaps && window.__bmCaps(\(c))") }
        }
    }

    // MARK: - Сообщения со страницы

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == AssetSchemeHandler.scheme,
              let body = message.body as? [String: Any], let m = body["m"] as? String else { return }
        let a = body["a"] as? [Any] ?? []
        let s = { (i: Int) -> String in i < a.count ? (a[i] as? String ?? "\(a[i])") : "" }
        switch m {
        case "startListening": startListening(s(0))
        case "stopListening": stopListening()
        case "speak": speak(s(0), lang: s(1))
        case "stopSpeaking": synth.stopSpeaking(at: .immediate)
        case "geocode": geocode(id: s(0), query: s(1))
        case "setNetworkSpeech":
            defaults.set((a.first as? Bool) ?? false, forKey: "net_speech")
            pushCapabilities()
        case "openSpeechSettings":
            if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
        case "clearTileCache":
            DispatchQueue.global(qos: .utility).async { self.tiles.clear(); self.pushCapabilities() }
        case "openAuth": openAuth(s(0))
        case "http": dmedHTTP(id: s(0), method: s(1), url: s(2), headers: s(3), body: s(4))
        case "location": requestLocation(id: (a.first as? NSNumber)?.intValue ?? 0, watch: false)
        case "watch": requestLocation(id: (a.first as? NSNumber)?.intValue ?? 0, watch: true)
        case "clearWatch":
            watches.remove((a.first as? NSNumber)?.intValue ?? 0)
            if watches.isEmpty { location.stopUpdatingLocation() }
        default: break
        }
    }

    // MARK: - Распознавание речи

    private func startListening(_ lang: String) {
        stopRecognition(cancel: true)
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { return self.emit("error", code: "denied") }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard granted else { return self.emit("error", code: "denied") }
                        self.begin(lang)
                    }
                }
            }
        }
    }

    private func begin(_ lang: String) {
        guard let rec = recognizer(lang) else { return emit("error", code: "unsupported") }
        let onDevice = rec.supportsOnDeviceRecognition
        // Как в 2.6/2.7 для Android: без офлайн-распознавания речь уходит на сервер Apple только с согласия.
        if !onDevice && !allowNetworkSpeech { return emit("error", code: "consent_required") }
        if !onDevice && !tiles.online { return emit("error", code: "network") }
        guard rec.isAvailable else { return emit("error", code: tiles.online ? "busy" : "network") }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = onDevice
        if #available(iOS 16.0, *) { req.addsPunctuation = false }
        request = req
        session += 1
        let my = session
        lastText = ""
        delivered = false
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try s.setActive(true, options: .notifyOthersOnDeactivation)
            let input = audio.inputNode
            input.removeTap(onBus: 0)
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0 else { return emit("error", code: "busy") }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak req] buf, _ in req?.append(buf) }
            audio.prepare()
            try audio.start()
        } catch {
            stopRecognition(cancel: true)
            return emit("error", code: "busy")
        }
        emit("ready")
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, my == self.session, !self.delivered else { return }
                if let r = result {
                    let t = r.bestTranscription.formattedString
                    if !t.isEmpty { self.lastText = t }
                    if r.isFinal { return self.deliver() }
                    self.emit("partial", text: t)
                    self.armSilence(after: 1.6)
                } else if error != nil {
                    self.deliver()
                }
            }
        }
        armSilence(after: 6) // ничего не сказали — «не расслышал»
        limitTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in self?.request?.endAudio() }
    }

    private func armSilence(after t: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: t, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            if self.lastText.isEmpty { self.deliver() } else { self.request?.endAudio() }
        }
    }

    private func deliver() {
        guard !delivered else { return }
        delivered = true
        if lastText.isEmpty { emit("error", code: "no_speech") } else { emit("result", text: lastText) }
        stopRecognition(cancel: false)
        emit("end")
    }

    private func stopListening() {
        guard task != nil else { return }
        request?.endAudio() // финальный результат придёт в обработчик
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in self?.deliver() }
    }

    private func stopRecognition(cancel: Bool) {
        silenceTimer?.invalidate(); silenceTimer = nil
        limitTimer?.invalidate(); limitTimer = nil
        if audio.isRunning { audio.stop() }
        audio.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        if cancel { task?.cancel() } else { task?.finish() }
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Озвучка

    private func speak(_ text: String, lang: String) {
        synth.stopSpeaking(at: .immediate)
        let t = String(text.prefix(3900))
        guard !t.isEmpty else { return emit("tts_done") }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: t)
        // узбекского голоса обычно нет — читаем по-русски
        u.voice = (lang.hasPrefix("uz") ? AVSpeechSynthesisVoice(language: "uz-UZ") : nil) ?? AVSpeechSynthesisVoice(language: "ru-RU")
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        emit("tts_start")
        synth.speak(u)
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { emit("tts_done") }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { emit("tts_done") }

    // MARK: - Геокодер (адрес → координаты в Ташкенте; нужен интернет)

    private func geocode(id: String, query: String) {
        guard !id.isEmpty, !query.isEmpty, query.count <= 300 else { return emitGeo(id, nil) }
        geoQueue.append((id, query))
        nextGeocode()
    }

    private func nextGeocode() {
        guard !geoBusy, !geoQueue.isEmpty else { return }
        geoBusy = true
        let (id, q) = geoQueue.removeFirst()
        let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: 41.31, longitude: 69.28), radius: 40000, identifier: "tashkent")
        geocoder.geocodeAddressString(q, in: region, preferredLocale: Locale(identifier: "ru_RU")) { [weak self] marks, _ in
            guard let self = self else { return }
            let c = marks?.first?.location?.coordinate
            let inside = c.map { $0.latitude > 40.9 && $0.latitude < 41.7 && $0.longitude > 68.9 && $0.longitude < 69.8 } ?? false
            self.emitGeo(id, inside ? c : nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { // не чаще ~1 запроса в секунду
                self.geoBusy = false
                self.nextGeocode()
            }
        }
    }

    private func emitGeo(_ id: String, _ c: CLLocationCoordinate2D?) {
        var o: [String: Any] = ["type": "geo", "id": id]
        if let c = c { o["lat"] = c.latitude; o["lon"] = c.longitude }
        send(o)
    }

    // MARK: - Геолокация

    private func requestLocation(id: Int, watch: Bool) {
        guard id > 0 else { return }
        if watch { watches.insert(id) } else { pendingLocation.append(id) }
        switch location.authorizationStatus {
        case .notDetermined: location.requestWhenInUseAuthorization()
        case .denied, .restricted: failLocation(code: 1)
        default: watch ? location.startUpdatingLocation() : location.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        switch m.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if !pendingLocation.isEmpty { m.requestLocation() }
            if !watches.isEmpty { m.startUpdatingLocation() }
        case .denied, .restricted: failLocation(code: 1)
        default: break
        }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        let ids = pendingLocation + Array(watches)
        pendingLocation.removeAll()
        for id in ids {
            js("window.__bmGeo && window.__bmGeo(\(id), true, \(l.coordinate.latitude), \(l.coordinate.longitude), \(max(0, l.horizontalAccuracy)))")
        }
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        failLocation(code: denied ? 1 : 2)
    }

    private func failLocation(code: Int) {
        let ids = pendingLocation + Array(watches)
        pendingLocation.removeAll()
        for id in ids { js("window.__bmGeo && window.__bmGeo(\(id), false, 0, 0, 0, \(code))") }
    }

    // MARK: - DMED (вход OAuth 2.0 + PKCE, только официальные хосты DHP)

    static func isDmedURL(_ raw: String) -> Bool {
        guard let u = URL(string: raw), u.scheme == "https", let h = u.host?.lowercased() else { return false }
        return h == "dhp.uz" || h.hasSuffix(".dhp.uz") || h == "medcore.uz" || h.hasSuffix(".medcore.uz")
    }

    private func openAuth(_ raw: String) {
        guard NativeBridge.isDmedURL(raw), let url = URL(string: raw) else { return }
        authSession?.cancel()
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: NativeBridge.authScheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.authSession = nil
                let back = callback?.absoluteString ?? (error != nil ? "\(NativeBridge.authScheme):/oauth2redirect?error=access_denied&state=" : nil)
                if let b = back, let lit = self.jsonString(b) { self.js("window.__bmAuth && window.__bmAuth(\(lit))") }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = true // не оставлять вход DMED в Safari
        authSession = session
        session.start()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        webView?.window ?? ASPresentationAnchor()
    }

    private func dmedHTTP(id: String, method: String, url raw: String, headers: String, body: String) {
        func done(_ status: Int, _ text: String) { send(["type": "http", "id": id, "status": status, "body": text]) }
        guard !id.isEmpty, NativeBridge.isDmedURL(raw), let url = URL(string: raw), method == "GET" || method == "POST" else { return done(0, "") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let d = headers.data(using: .utf8), let h = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            for (k, v) in h where k.range(of: "^[A-Za-z0-9-]{1,40}$", options: .regularExpression) != nil {
                req.setValue("\(v)", forHTTPHeaderField: k)
            }
        }
        if method == "POST" { req.httpBody = body.data(using: .utf8) }
        http.dataTask(with: req) { data, resp, _ in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let d = data ?? Data()
            done(d.count > 2 * 1024 * 1024 ? 0 : status, d.count > 2 * 1024 * 1024 ? "" : String(data: d, encoding: .utf8) ?? "")
        }.resume()
    }

    private func jsonString(_ s: String) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]), let a = String(data: d, encoding: .utf8) else { return nil }
        return String(a.dropFirst().dropLast()) // ["..."] → "..."
    }

    // MARK: - События для страницы

    private func emit(_ type: String, text: String? = nil, code: String? = nil) {
        var o: [String: Any] = ["type": type]
        if let t = text { o["text"] = t }
        if let c = code { o["code"] = c }
        send(o)
    }

    private func send(_ o: [String: Any]) {
        let s = json(o)
        DispatchQueue.main.async { self.js("window.__bmVoice && window.__bmVoice(\(s))") }
    }

    private func js(_ code: String) {
        webView?.evaluateJavaScript(code, completionHandler: nil)
    }

    private func json(_ o: [String: Any]) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: o), var s = String(data: d, encoding: .utf8) else { return "{}" }
        // U+2028/2029 допустимы в JSON, но ломают JS-строку
        s = s.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return s
    }
}
