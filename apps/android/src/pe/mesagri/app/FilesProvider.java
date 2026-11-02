package pe.mesagri.app;

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

/**
 * Archivos que la app comparte con otras apps del celular, sin permisos de almacenamiento:
 * - fotos/: donde la app de cámara guarda la foto que se toma desde Mesagri;
 * - docs/: constancias y reportes (PDF o CSV) para guardar o compartir.
 */
public class FilesProvider extends ContentProvider {
    static final String AUTHORITY = "pe.mesagri.app.archivos";

    static Uri newPhoto(Context c) {
        File dir = new File(c.getCacheDir(), "fotos");
        if (!dir.exists()) dir.mkdirs();
        return Uri.parse("content://" + AUTHORITY + "/fotos/foto-" + System.currentTimeMillis() + ".jpg");
    }

    static Uri docUri(String name) {
        return Uri.parse("content://" + AUTHORITY + "/docs/" + Uri.encode(name));
    }

    static boolean hasContent(Context c, Uri u) {
        File f = fileOf(c, u);
        return f != null && f.exists() && f.length() > 0;
    }

    private static File fileOf(Context c, Uri u) {
        if (c == null || u == null || u.getPathSegments().size() != 2) return null;
        String folder = u.getPathSegments().get(0);
        String name = u.getPathSegments().get(1);
        if (!("fotos".equals(folder) || "docs".equals(folder))) return null;
        if (name.contains("/") || name.contains("..")) return null;
        return new File(new File(c.getCacheDir(), folder), name);
    }

    @Override
    public boolean onCreate() { return true; }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment().toLowerCase();
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".pdf")) return "application/pdf";
        if (n.endsWith(".csv")) return "text/csv";
        return "application/octet-stream";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileOf(getContext(), uri);
        if (f == null) throw new FileNotFoundException("No permitido");
        File dir = f.getParentFile();
        if (dir != null && !dir.exists()) dir.mkdirs();
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode == null ? "r" : mode));
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        File f = fileOf(getContext(), uri);
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f == null ? null : f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f == null ? null : f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] args) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
