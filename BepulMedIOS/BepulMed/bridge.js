// BepulMed AI — iOS: тот же мост window.BepulMedNative, что и в Android-приложении.
// WKWebView умеет только асинхронные сообщения, поэтому capabilities() отдаёт кэш,
// который приложение обновляет через window.__bmCaps(...). Подставляется при запуске: __BM_CAPS__.
(function () {
  if (window.BepulMedNative) return;
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bm;
  if (!h) return;
  var caps = __BM_CAPS__;
  function post(m, a) {
    try { h.postMessage({ m: m, a: a || [] }); } catch (e) { /* нет моста */ }
  }
  window.__bmCaps = function (c) { if (c && typeof c === "object") caps = c; };
  window.BepulMedNative = {
    capabilities: function () { return JSON.stringify(caps); },
    startListening: function (lang) { post("startListening", [String(lang || "ru-RU")]); },
    stopListening: function () { post("stopListening"); },
    speak: function (text, lang) { post("speak", [String(text || ""), String(lang || "ru-RU")]); },
    stopSpeaking: function () { post("stopSpeaking"); },
    geocode: function (id, q) { post("geocode", [String(id), String(q || "")]); },
    setNetworkSpeech: function (allow) { caps.netSpeechAllowed = !!allow; caps.stt = !!(caps.sttOnDevice || (allow && caps.sttNetwork)); post("setNetworkSpeech", [!!allow]); },
    openSpeechSettings: function () { post("openSpeechSettings"); },
    clearTileCache: function () { caps.tiles = 0; caps.tileBytes = 0; post("clearTileCache"); },
    // DMED: вход в системном окне Apple и запросы к *.dhp.uz из приложения (без CORS).
    openAuth: function (url) { post("openAuth", [String(url || "")]); },
    http: function (id, method, url, headers, body) { post("http", [String(id), String(method), String(url), String(headers || "{}"), String(body || "")]); },
  };

  // Геолокация через CoreLocation: страница открыта со схемы bepulmed://, где браузерная геолокация недоступна.
  var cbs = {}, seq = 0;
  function err(code) { return { code: code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }; }
  window.__bmGeo = function (id, ok, lat, lon, acc, code) {
    var c = cbs[id];
    if (!c) return;
    if (!c.watch) delete cbs[id];
    if (ok) c.s({ coords: { latitude: lat, longitude: lon, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
    else if (c.e) c.e(err(code || 2));
  };
  var geo = {
    getCurrentPosition: function (s, e, o) {
      var id = ++seq;
      cbs[id] = { s: s, e: e };
      post("location", [id]);
      var t = (o && o.timeout) || 20000;
      setTimeout(function () { if (cbs[id]) { delete cbs[id]; if (e) e(err(3)); } }, t);
    },
    watchPosition: function (s, e) { var id = ++seq; cbs[id] = { s: s, e: e, watch: true }; post("watch", [id]); return id; },
    clearWatch: function (id) { delete cbs[id]; post("clearWatch", [id]); },
  };
  try { Object.defineProperty(navigator, "geolocation", { configurable: true, get: function () { return geo; } }); } catch (e) { /* оставляем как есть */ }
})();
