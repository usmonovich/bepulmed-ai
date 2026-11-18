package uz.bepulmed.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Минимальный провайдер для фото с камеры (замена androidx FileProvider без внешних библиотек).
 * Отдаёт только файлы doc_*.jpg из cache/camera, не экспортируется, доступ — через временное разрешение на URI.
 */
public class CameraProvider extends ContentProvider {
    static final String AUTHORITY = "uz.bepulmed.app.camera";
    private static final long MAX_AGE_MS = 24L * 60 * 60 * 1000;

    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "camera");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    /** Новый пустой файл для снимка и его content:// адрес. */
    static Uri newPhoto(Context c) throws IOException {
        File f = File.createTempFile("doc_", ".jpg", dir(c));
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(f.getName()).build();
    }

    /** Удаляем снимки старше суток: медицинские документы не должны копиться на телефоне. */
    static void cleanup(Context c) {
        File[] files = dir(c).listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (now - f.lastModified() > MAX_AGE_MS) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    private File file(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("doc_[0-9A-Za-z_-]+\\.jpg")) throw new FileNotFoundException("forbidden");
        Context c = getContext();
        if (c == null) throw new FileNotFoundException("no context");
        return new File(dir(c), name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = file(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
