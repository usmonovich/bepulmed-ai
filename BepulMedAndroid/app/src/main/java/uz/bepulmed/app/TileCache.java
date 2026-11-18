package uz.bepulmed.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Офлайн-кэш тайлов OpenStreetMap: сохраняем только то, что пользователь сам
 * просмотрел (массовая предзагрузка запрещена правилами tile.openstreetmap.org).
 * Без сети отдаём сохранённый тайл; со связью — обновляем тайлы старше 7 дней.
 */
final class TileCache {
    private static final Pattern TILE = Pattern.compile("^/(\\d{1,2})/(\\d{1,7})/(\\d{1,7})\\.png$");
    private static final long MAX_AGE_MS = 7L * 24 * 3600 * 1000;
    private static final long MAX_BYTES = 120L * 1024 * 1024;
    private static final String UA = "BepulMedAI/" + MainActivity.VERSION + " (Android; offline tile cache)";
    private final File dir;
    private volatile long writesSincePrune = 0;

    TileCache(Context c) {
        dir = new File(c.getCacheDir(), "tiles");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    static boolean isTile(Uri u) {
        return u != null && "https".equals(u.getScheme()) && "tile.openstreetmap.org".equals(u.getHost())
                && u.getPath() != null && TILE.matcher(u.getPath()).matches();
    }

    private File fileFor(Uri u) {
        Matcher m = TILE.matcher(u.getPath());
        if (!m.matches()) return null;
        return new File(dir, m.group(1) + "_" + m.group(2) + "_" + m.group(3) + ".png");
    }

    WebResourceResponse serve(Uri u, boolean online) {
        File f = fileFor(u);
        if (f == null) return null;
        boolean fresh = f.exists() && System.currentTimeMillis() - f.lastModified() < MAX_AGE_MS;
        if (f.exists() && (fresh || !online)) return fromFile(f);
        if (!online) return notFound();
        byte[] data = download(u.toString());
        if (data != null) {
            save(f, data);
            return png(new ByteArrayInputStream(data));
        }
        return f.exists() ? fromFile(f) : notFound();
    }

    private byte[] download(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestProperty("User-Agent", UA);
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream(16384);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 512 * 1024) return null;
            }
            in.close();
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void save(File f, byte[] data) {
        File tmp = new File(f.getPath() + ".tmp");
        try {
            FileOutputStream o = new FileOutputStream(tmp);
            o.write(data);
            o.close();
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(f);
        } catch (IOException ignored) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
        if (++writesSincePrune >= 200) {
            writesSincePrune = 0;
            prune();
        }
    }

    synchronized void prune() {
        File[] all = dir.listFiles();
        if (all == null) return;
        long total = 0;
        for (File f : all) total += f.length();
        if (total <= MAX_BYTES) return;
        Arrays.sort(all, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        for (File f : all) {
            if (total <= MAX_BYTES * 8 / 10) break;
            total -= f.length();
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /** {"count":N,"bytes":B} */
    long[] stats() {
        File[] all = dir.listFiles();
        long n = 0, b = 0;
        if (all != null) for (File f : all) if (f.getName().endsWith(".png")) { n++; b += f.length(); }
        return new long[] {n, b};
    }

    void clear() {
        File[] all = dir.listFiles();
        if (all != null) for (File f : all) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private static WebResourceResponse fromFile(File f) {
        try {
            return png(new FileInputStream(f));
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse png(InputStream in) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "max-age=86400");
        return new WebResourceResponse("image/png", null, 200, "OK", h, in);
    }

    private static WebResourceResponse notFound() {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("image/png", null, 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
    }
}
