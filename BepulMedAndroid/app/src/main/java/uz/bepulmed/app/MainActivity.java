package uz.bepulmed.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.location.Address;
import android.location.Geocoder;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * BepulMed AI для Android.
 *
 * Интерфейс (React-сборка bepulmed/web/dist) лежит ВНУТРИ APK в assets/www и отдаётся WebView по адресу
 * https://appassets.androidplatform.net/ — домен, зарезервированный Android для локального контента.
 * Поэтому приложение открывается мгновенно, а SOS, медкарта и сканер работают и без интернета.
 * Запись, очередь, чат и карта ходят на сервер BepulMed (Cloudflare Worker), адрес задаётся в самом приложении.
 *
 * Оболочка даёт странице то, чего WebView не умеет сам: разрешения на камеру/микрофон/геолокацию,
 * съёмку и выбор фото, набор 103/112, SMS и «Поделиться» для SOS, открытие карт и внешних ссылок.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final String VERSION = "2.13";

    private static final int REQ_WEB_PERMS = 1;
    private static final int REQ_GEO = 2;
    private static final int REQ_CAMERA_FOR_FILE = 3;
    private static final int REQ_MIC = 4;
    private static final int REQ_FILE = 10;

    // Голос: системное распознавание речи и синтез (работают без сервера BepulMed).
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private volatile boolean ttsUz = false;
    private String pendingListenLang;
    private volatile String currentHost = "";
    private boolean recognizerOnDevice = false;
    /** Согласие пользователя на сетевое распознавание речи (хранится на устройстве). */
    private volatile boolean allowNetworkSpeech = false;

    private WebView web;
    private PermissionRequest pendingWebPermission;
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private ValueCallback<Uri[]> fileCallback;
    private WebChromeClient.FileChooserParams pendingChooser;
    private Uri cameraPhotoUri;

    // ---------- Жизненный цикл ----------

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect на компьютере
        }
        CameraProvider.cleanup(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage: медкарта, адрес сервера, язык
        s.setMediaPlaybackRequiresUserGesture(false); // превью камеры в сканере QR, озвучка
        s.setGeolocationEnabled(true);
        s.setSupportMultipleWindows(true); // window.open → onCreateWindow
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // фото с камеры (content://) для <input type=file>
        s.setUserAgentString(s.getUserAgentString() + " BepulMedAndroid/" + VERSION);

        web.addJavascriptInterface(new VoiceBridge(), "BepulMedNative");
        initTts();
        allowNetworkSpeech = getSharedPreferences("bm", MODE_PRIVATE).getBoolean("net_speech", false);
        web.setWebViewClient(new AppClient());
        web.setWebChromeClient(new ChromeClient());

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
        takeAuthIntent(getIntent());
    }

    // ---------- DMED: возврат из браузера после входа ----------
    static final String AUTH_SCHEME = "uz.bepulmed.app";
    private String pendingAuth;
    private boolean pageReady;

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        takeAuthIntent(intent);
    }

    private void takeAuthIntent(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !AUTH_SCHEME.equals(u.getScheme())) return;
        intent.setData(null); // не обрабатывать повторно при повороте экрана
        pendingAuth = u.toString();
        deliverAuth();
    }

    private void deliverAuth() {
        if (pendingAuth == null || !pageReady) return;
        String u = pendingAuth;
        pendingAuth = null;
        web.evaluateJavascript("window.__bmAuth&&window.__bmAuth(" + JSONObject.quote(u) + ")", null);
    }

    /** Только официальные хосты DHP/DMED и только https. */
    static boolean isDmedUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            String h = u.getHost();
            return "https".equals(u.getScheme()) && h != null && (h.equals("dhp.uz") || h.endsWith(".dhp.uz") || h.equals("medcore.uz") || h.endsWith(".medcore.uz"));
        } catch (Exception e) {
            return false;
        }
    }

    private void sendEvent(final JSONObject o) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__bmVoice&&window.__bmVoice(" + JSONObject.quote(o.toString()) + ")", null);
            }
        });
    }

    /** HTTP к DMED из приложения (у WebView с локальным источником нет CORS-доступа к sso/fhir). */
    private void dmedHttp(final String id, final String method, final String url, final String headersJson, final String body) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                int status = 0;
                String text = "";
                java.net.HttpURLConnection c = null;
                try {
                    if (!isDmedUrl(url) || !("GET".equals(method) || "POST".equals(method))) throw new IOException("blocked");
                    c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(15000);
                    c.setRequestMethod(method);
                    c.setUseCaches(false);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    java.util.Iterator<String> it = h.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        if (k.matches("[A-Za-z0-9-]{1,40}")) c.setRequestProperty(k, h.optString(k));
                    }
                    if ("POST".equals(method)) {
                        byte[] b = (body == null ? "" : body).getBytes("UTF-8");
                        c.setDoOutput(true);
                        c.setFixedLengthStreamingMode(b.length);
                        c.getOutputStream().write(b);
                    }
                    status = c.getResponseCode();
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (in != null) {
                        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            if (out.size() > 2 * 1024 * 1024) throw new IOException("too_large");
                        }
                        in.close();
                        text = out.toString("UTF-8");
                    }
                } catch (Exception e) {
                    status = 0;
                    text = "";
                } finally {
                    if (c != null) c.disconnect();
                }
                JSONObject o = new JSONObject();
                try {
                    o.put("type", "http");
                    o.put("id", id);
                    o.put("status", status);
                    o.put("body", text);
                } catch (JSONException ignored) {
                    return;
                }
                sendEvent(o);
            }
        }).start();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        if (recognizer != null) recognizer.cancel();
        if (tts != null) tts.stop();
        web.onPause(); // не опрашиваем сервер в фоне
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = null;
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ---------- Локальные файлы интерфейса ----------

    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("wasm", "application/wasm");
        MIME.put("txt", "text/plain");
    }

    static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String m = MIME.get(ext);
        return m != null ? m : "application/octet-stream";
    }

    /** Путь запроса → файл в assets/www. Пути без расширения (маршруты приложения) → index.html. */
    static String assetPath(String rawPath) {
        String p = rawPath == null ? "" : rawPath;
        while (p.startsWith("/")) p = p.substring(1);
        if (p.contains("..") || p.contains("\\")) return null; // за пределы assets/www не выходим
        if (p.isEmpty()) return "index.html";
        String last = p.substring(p.lastIndexOf('/') + 1);
        return last.contains(".") ? p : "index.html";
    }

    private TileCache tileCache;

    private synchronized TileCache tiles() {
        if (tileCache == null) tileCache = new TileCache(getApplicationContext());
        return tileCache;
    }

    private WebResourceResponse serveAsset(Uri uri, Map<String, String> reqHeaders) {
        String path = assetPath(uri.getPath());
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        if (path != null) {
            String range = null;
            if (reqHeaders != null) for (Map.Entry<String, String> e : reqHeaders.entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            // Офлайн-карта (.pmtiles) читается кусками: Range → 206 Partial Content.
            if (range != null && path.endsWith(".pmtiles")) {
                WebResourceResponse r = serveRange("www/" + path, range, headers);
                if (r != null) return r;
            }
            try {
                InputStream in = getAssets().open("www/" + path);
                String mime = mimeOf(path);
                boolean text = mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
                return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
            } catch (IOException ignored) {
                // нет файла — 404 ниже
            }
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
    }

    /** bytes=a-b из несжатого asset (aapt2 -0 pmtiles) без чтения файла целиком. */
    private WebResourceResponse serveRange(String asset, String range, Map<String, String> headers) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^bytes=(\\d+)-(\\d*)$").matcher(range.trim());
        if (!m.matches()) return null;
        try {
            android.content.res.AssetFileDescriptor afd = getAssets().openFd(asset);
            long size = afd.getLength();
            long start = Long.parseLong(m.group(1));
            long end = m.group(2).isEmpty() ? size - 1 : Math.min(Long.parseLong(m.group(2)), size - 1);
            if (start >= size || end < start) {
                afd.close();
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse("application/octet-stream", null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
            }
            long len = end - start + 1;
            java.io.FileInputStream fin = afd.createInputStream();
            long skip = start;
            while (skip > 0) {
                long k = fin.skip(skip);
                if (k <= 0) break;
                skip -= k;
            }
            byte[] buf = new byte[(int) Math.min(len, 8L * 1024 * 1024)];
            int off = 0;
            while (off < buf.length) {
                int n = fin.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
            fin.close();
            afd.close();
            headers.put("Content-Range", "bytes " + start + "-" + (start + off - 1) + "/" + size);
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", String.valueOf(off));
            byte[] body = off == buf.length ? buf : java.util.Arrays.copyOf(buf, off);
            return new WebResourceResponse("application/octet-stream", null, 206, "Partial Content", headers, new ByteArrayInputStream(body));
        } catch (IOException e) {
            return null; // сжатый asset или нет файла — обычный ответ
        }
    }

    // ---------- Ссылки ----------

    /** Доверяем только точному HTTPS origin локальных assets, а не совпадению имени host. */
    private boolean isTrustedOrigin(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && HOST.equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null;
    }

    /** true — обработано вне WebView. */
    private boolean route(Uri uri) {
        if (isTrustedOrigin(uri)) return false;
        if ("bepulmed".equals(uri.getScheme())) {
            if ("share".equals(uri.getHost())) shareText(uri.getQueryParameter("text"));
            return true;
        }
        openExternal(uri);
        return true;
    }

    /** SOS: системное «Поделиться» — WhatsApp, Telegram, SMS… Получателя выбирает человек. */
    private void shareText(String text) {
        if (text == null || text.isEmpty()) return;
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        try {
            startActivity(Intent.createChooser(send, getString(R.string.share_sos)));
        } catch (ActivityNotFoundException e) {
            toast(R.string.no_app);
        }
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        Intent intent;
        if (scheme.equals("tel")) {
            intent = new Intent(Intent.ACTION_DIAL, uri); // набор номера: звонок подтверждает человек
        } else if (scheme.equals("sms") || scheme.equals("smsto") || scheme.equals("mailto")) {
            // sms:+998…?body=… — «непрозрачный» URI: getQueryParameter() на нём бросает исключение, разбираем сами.
            String ssp = uri.getEncodedSchemeSpecificPart();
            String body = null;
            int q = ssp == null ? -1 : ssp.indexOf('?');
            if (q >= 0) {
                body = Uri.parse("x://x/?" + ssp.substring(q + 1)).getQueryParameter("body");
                uri = Uri.parse(scheme + ":" + ssp.substring(0, q));
            }
            intent = new Intent(Intent.ACTION_SENDTO, uri);
            if (body != null) {
                intent.putExtra("sms_body", body);
                intent.putExtra(Intent.EXTRA_TEXT, body);
            }
        } else if (scheme.equals("intent")) {
            try {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } catch (URISyntaxException e) {
                return;
            }
        } else if (scheme.equals("http") || scheme.equals("https") || scheme.equals("geo") || scheme.equals("market")) {
            intent = new Intent(Intent.ACTION_VIEW, uri);
        } else {
            return; // javascript:, file: и прочее не открываем
        }
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            toast(R.string.no_app);
        }
    }

    private void toast(int res) {
        Toast.makeText(this, res, Toast.LENGTH_SHORT).show();
    }

    private class AppClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (isTrustedOrigin(Uri.parse(url))) {
                pageReady = true;
                deliverAuth();
            }
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (isTrustedOrigin(u)) return serveAsset(u, request.getRequestHeaders());
            if (TileCache.isTile(u) && "GET".equalsIgnoreCase(request.getMethod())) return tiles().serve(u, isOnline());
            return null; // API сервера, карты, CDN — как обычно, по сети
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return route(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            currentHost = url != null && isTrustedOrigin(Uri.parse(url)) ? HOST : "";
        }
    }

    // ---------- Разрешения, файлы, новые окна ----------

    private boolean has(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean allowed(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return has(Manifest.permission.CAMERA);
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return has(Manifest.permission.RECORD_AUDIO);
        return false;
    }

    private void answerWebPermission(PermissionRequest req) {
        List<String> ok = new ArrayList<String>();
        for (String r : req.getResources()) if (allowed(r)) ok.add(r);
        if (ok.isEmpty()) req.deny();
        else req.grant(ok.toArray(new String[0]));
    }

    private class ChromeClient extends WebChromeClient {

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (!isTrustedOrigin(request.getOrigin())) { // только точный origin нашего интерфейса
                request.deny();
                return;
            }
            List<String> need = new ArrayList<String>();
            for (String r : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
            }
            if (need.isEmpty()) {
                answerWebPermission(request);
                return;
            }
            if (pendingWebPermission != null) pendingWebPermission.deny();
            pendingWebPermission = request;
            requestPermissions(need.toArray(new String[0]), REQ_WEB_PERMS);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingWebPermission == request) pendingWebPermission = null;
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!isTrustedOrigin(Uri.parse(origin))) {
                callback.invoke(origin, false, false);
                return;
            }
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                callback.invoke(origin, true, false);
                return;
            }
            if (pendingGeoCallback != null) pendingGeoCallback.invoke(pendingGeoOrigin, false, false);
            pendingGeoOrigin = origin;
            pendingGeoCallback = callback;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_GEO);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            if (params.isCaptureEnabled() && !has(Manifest.permission.CAMERA)) {
                pendingChooser = params;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_FOR_FILE);
            } else {
                openChooser(params);
            }
            return true;
        }

        /** window.open: внешние ссылки (маршрут, источник) — во внешнем приложении, свои — в этом окне. */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                private boolean done = false;

                private void handle(WebView v, Uri uri) {
                    if (done || uri == null || "about:blank".equals(uri.toString())) return;
                    done = true;
                    if (isTrustedOrigin(uri)) web.loadUrl(uri.toString());
                    else route(uri);
                    v.stopLoading();
                    v.post(new Runnable() {
                        @Override
                        public void run() {
                            popup.destroy();
                        }
                    });
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    handle(v, r.getUrl());
                    return true;
                }

                @Override
                public void onPageStarted(WebView v, String url, Bitmap favicon) {
                    handle(v, url == null ? null : Uri.parse(url));
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }

    /** Съёмка в наш файл; null, если камеры/разрешения нет. */
    private Intent cameraIntent() {
        if (!has(Manifest.permission.CAMERA)) return null;
        try {
            Uri uri = CameraProvider.newPhoto(this);
            cameraPhotoUri = uri;
            return new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (IOException e) {
            return null;
        }
    }

    /** <input capture> → сразу камера; иначе выбор: галерея + камера. */
    private void openChooser(WebChromeClient.FileChooserParams params) {
        Intent camera = cameraIntent();
        Intent intent;
        if (params.isCaptureEnabled() && camera != null) {
            intent = camera;
        } else {
            // createIntent() берёт только первый тип из accept («image/*»), и PDF нельзя выбрать —
            // передаём все MIME-типы через EXTRA_MIME_TYPES.
            Intent pick = params.createIntent();
            java.util.ArrayList<String> mimes = new java.util.ArrayList<String>();
            String[] accept = params.getAcceptTypes();
            if (accept != null) for (String a : accept) {
                if (a == null) continue;
                String m = a.trim();
                if (".pdf".equalsIgnoreCase(m)) m = "application/pdf";
                if (m.contains("/") && !mimes.contains(m)) mimes.add(m);
            }
            if (mimes.size() > 1) {
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            }
            intent = Intent.createChooser(pick, getString(R.string.choose_photo));
            if (camera != null) intent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(intent, REQ_FILE);
        } catch (ActivityNotFoundException e) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
            cameraPhotoUri = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        if (uris == null && resultCode == RESULT_OK && cameraPhotoUri != null) uris = new Uri[]{cameraPhotoUri};
        fileCallback.onReceiveValue(uris); // отвечаем всегда, иначе поле выбора «зависнет»
        fileCallback = null;
        cameraPhotoUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_WEB_PERMS && pendingWebPermission != null) {
            PermissionRequest req = pendingWebPermission;
            pendingWebPermission = null;
            answerWebPermission(req);
        } else if (requestCode == REQ_GEO && pendingGeoCallback != null) {
            boolean granted = false;
            for (int r : grantResults) granted |= r == PackageManager.PERMISSION_GRANTED;
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        } else if (requestCode == REQ_MIC) {
            String lang = pendingListenLang;
            pendingListenLang = null;
            if (lang != null && has(Manifest.permission.RECORD_AUDIO)) beginListening(lang);
            else emit("error", null, "denied");
        } else if (requestCode == REQ_CAMERA_FOR_FILE && pendingChooser != null) {
            WebChromeClient.FileChooserParams p = pendingChooser;
            pendingChooser = null;
            openChooser(p); // без разрешения — останется галерея
        }
    }

    // ---------- Голос ----------

    private void initTts() {
        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status != TextToSpeech.SUCCESS) return;
                ttsReady = true;
                ttsUz = tts.isLanguageAvailable(new Locale("uz", "UZ")) >= TextToSpeech.LANG_AVAILABLE;
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String id) {
                        emit("tts_start", null, null);
                    }

                    @Override
                    public void onDone(String id) {
                        emit("tts_done", null, null);
                    }

                    @Override
                    @SuppressWarnings("deprecation")
                    public void onError(String id) {
                        emit("tts_done", null, null);
                    }
                });
            }
        });
    }

    /** Событие в страницу: window.__bmVoice({type, text, code}). */
    private void emit(String type, String text, String code) {
        final JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            if (text != null) o.put("text", text);
            if (code != null) o.put("code", code);
        } catch (JSONException ignored) {
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__bmVoice&&window.__bmVoice(" + JSONObject.quote(o.toString()) + ")", null);
            }
        });
    }

    static String sttErrorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "denied";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no_speech";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                return "network";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "busy";
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED (API 31)
            case 13: // ERROR_LANGUAGE_UNAVAILABLE (API 31)
                return "unsupported";
            default:
                return "other";
        }
    }

    private final RecognitionListener sttListener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { emit("ready", null, null); }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override
        public void onError(int error) {
            emit("error", null, sttErrorCode(error));
        }

        @Override
        public void onPartialResults(Bundle partial) {
            ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (r != null && !r.isEmpty() && !r.get(0).isEmpty()) emit("partial", r.get(0), null);
        }

        @Override
        public void onResults(Bundle results) {
            ArrayList<String> r = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            emit("result", r != null && !r.isEmpty() ? r.get(0) : "", null);
        }
    };

    /** Только на UI-потоке. */
    private void beginListening(String lang) {
        if (!has(Manifest.permission.RECORD_AUDIO)) {
            pendingListenLang = lang;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        if (tts != null) tts.stop();
        // По умолчанию — только распознавание на устройстве: медицинская речь не уходит в сеть.
        // Сетевой сервис (Google) — только после явного согласия пользователя в приложении.
        boolean onDevice = onDeviceSttAvailable();
        boolean network = !onDevice && allowNetworkSpeech && SpeechRecognizer.isRecognitionAvailable(this);
        if (!onDevice && !network) {
            emit("error", null, SpeechRecognizer.isRecognitionAvailable(this) ? "consent_required" : "unsupported");
            return;
        }
        if (recognizer != null && recognizerOnDevice != onDevice) {
            recognizer.destroy();
            recognizer = null;
        }
        if (recognizer == null) {
            recognizer = onDevice ? SpeechRecognizer.createOnDeviceSpeechRecognizer(this) : SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(sttListener);
            recognizerOnDevice = onDevice;
        } else {
            recognizer.cancel();
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, onDevice || !isOnline());
        recognizer.startListening(i);
    }

    /** isOnDeviceRecognitionAvailable появился только в API 33 — на Android 12 его вызов роняет приложение. */
    private boolean onDeviceSttAvailable() {
        return Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this);
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network n = cm.getActiveNetwork();
        NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** Результат геокодирования в страницу: {type:"geo", id, lat, lon}. */
    private void emitGeo(String id, Double lat, Double lon) {
        final JSONObject o = new JSONObject();
        try {
            o.put("type", "geo");
            o.put("id", id);
            if (lat != null && lon != null) {
                o.put("lat", lat);
                o.put("lon", lon);
            }
        } catch (JSONException ignored) {
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__bmVoice&&window.__bmVoice(" + JSONObject.quote(o.toString()) + ")", null);
            }
        });
    }

    static String cleanLang(String lang) {
        return lang != null && lang.matches("[a-z]{2}(-[A-Z]{2})?") ? lang : "ru-RU";
    }

    /** Мост для страницы. Методы вызываются не на UI-потоке; доступен только нашему интерфейсу из assets. */
    private class VoiceBridge {
        private boolean ours() {
            return HOST.equals(currentHost);
        }

        @JavascriptInterface
        public String capabilities() {
            JSONObject o = new JSONObject();
            try {
                boolean onDev = onDeviceSttAvailable();
                boolean net = SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
                o.put("sttOnDevice", ours() && onDev);
                o.put("sttNetwork", ours() && net);
                o.put("netSpeechAllowed", allowNetworkSpeech);
                o.put("stt", ours() && (onDev || (allowNetworkSpeech && net)));
                o.put("tts", ours() && ttsReady);
                o.put("ttsUz", ttsUz);
                o.put("geo", Geocoder.isPresent());
                o.put("online", isOnline());
                if (ours()) {
                    long[] ts = tiles().stats();
                    o.put("tiles", ts[0]);
                    o.put("tileBytes", ts[1]);
                }
            } catch (JSONException ignored) {
                // пустой объект
            }
            return o.toString();
        }

        @JavascriptInterface
        public void openAuth(final String url) {
            if (!ours() || !isDmedUrl(url)) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "Нет браузера для входа в DMED", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void http(String id, String method, String url, String headers, String body) {
            if (!ours() || id == null || url == null) return;
            dmedHttp(id, method, url, headers, body);
        }

        @JavascriptInterface
        public void clearTileCache() {
            if (ours()) tiles().clear();
        }

        @JavascriptInterface
        public void startListening(final String lang) {
            if (!ours()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    beginListening(cleanLang(lang));
                }
            });
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (recognizer != null) recognizer.stopListening();
                }
            });
        }

        @JavascriptInterface
        public void speak(final String text, final String lang) {
            if (!ours() || !ttsReady || text == null) {
                emit("tts_done", null, null);
                return;
            }
            boolean uz = cleanLang(lang).startsWith("uz") && ttsUz;
            tts.setLanguage(uz ? new Locale("uz", "UZ") : new Locale("ru", "RU")); // узбекского голоса нет — читаем по-русски
            String t = text.length() > 3900 ? text.substring(0, 3900) : text;
            tts.speak(t, TextToSpeech.QUEUE_FLUSH, null, "bm-" + System.nanoTime());
        }

        /** Координаты адреса в границах Ташкента (системный геокодер, нужен интернет). Ответ — событие "geo". */
        @JavascriptInterface
        public void geocode(final String id, final String query) {
            if (!ours() || id == null || query == null || query.length() > 300 || !Geocoder.isPresent()) {
                emitGeo(id == null ? "" : id, null, null);
                return;
            }
            new Thread(new Runnable() {
                @Override
                @SuppressWarnings("deprecation")
                public void run() {
                    try {
                        Geocoder g = new Geocoder(MainActivity.this, new Locale("ru", "RU"));
                        List<Address> r = g.getFromLocationName(query, 1, 41.10, 69.05, 41.50, 69.55);
                        if (r != null && !r.isEmpty() && r.get(0).hasLatitude() && r.get(0).hasLongitude()) {
                            emitGeo(id, r.get(0).getLatitude(), r.get(0).getLongitude());
                            return;
                        }
                    } catch (IOException | IllegalArgumentException e) {
                        // нет сети или сервис недоступен
                    }
                    emitGeo(id, null, null);
                }
            }).start();
        }

        /** Пользователь в приложении явно разрешил/запретил сетевое распознавание речи. */
        @JavascriptInterface
        public void setNetworkSpeech(boolean allow) {
            if (!ours()) return;
            allowNetworkSpeech = allow;
            getSharedPreferences("bm", MODE_PRIVATE).edit().putBoolean("net_speech", allow).apply();
        }

        /** Открыть системные настройки голосового ввода (там скачивается офлайн-пакет языка). */
        @JavascriptInterface
        public void openSpeechSettings() {
            if (!ours()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(android.provider.Settings.ACTION_VOICE_INPUT_SETTINGS));
                    } catch (ActivityNotFoundException e) {
                        try {
                            startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
                        } catch (ActivityNotFoundException ignored) {
                            toast(R.string.no_app);
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            if (tts != null) tts.stop();
        }
    }
}
