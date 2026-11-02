package pe.mesagri.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Mesagri para Android. La app web autónoma (assets/www) se abre en un WebView desde una dirección
 * https propia del celular (https://appassets.androidplatform.net), así guarda sus datos, usa el GPS
 * y la cámara como una app normal. Lo que no es de la app (llamadas, mapas, WhatsApp) se abre afuera.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 11;
    private static final int REQ_LOCATION = 12;
    private static final int REQ_VOICE = 13;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private TextToSpeech tts;
    private boolean ttsReady;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFF1E3F20);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " MesagriApp/" + BuildInfo.VERSION);

        web.addJavascriptInterface(new Bridge(), "MesagriAndroid");
        web.setWebViewClient(new AppClient());
        web.setWebChromeClient(new ChromeClient());

        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(START);
        startVoice();
    }

    /* ---------------- Voz: guía de audio y dictado ---------------- */

    private void startVoice() {
        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status != TextToSpeech.SUCCESS || tts == null) return;
                    int r = tts.setLanguage(new Locale("es", "PE"));
                    if (r < 0) r = tts.setLanguage(new Locale("es", "US"));
                    if (r < 0) r = tts.setLanguage(new Locale("es"));
                    ttsReady = r >= 0;
                    tts.setSpeechRate(0.95f);
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) { }
                        @Override public void onDone(String id) { js("window.__mesagriSpoken && window.__mesagriSpoken()"); }
                        @Override public void onError(String id) { js("window.__mesagriSpoken && window.__mesagriSpoken()"); }
                    });
                }
            });
        } catch (Exception e) {
            ttsReady = false;
        }
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() { if (web != null) web.evaluateJavascript(code, null); }
        });
    }

    private static String quote(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    private void heard(String text, String error) {
        js("window.__mesagriHeard && window.__mesagriHeard(" + quote(text) + ", " + quote(error) + ")");
    }

    /* ---------------- La app desde los archivos del APK ---------------- */

    private class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            return asset(u.getPath());
        }

        // (la variante con WebResourceRequest llama a esta en todas las versiones de Android)
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri u = Uri.parse(url);
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
            openOutside(u);
            return true;
        }
    }

    private WebResourceResponse asset(String path) {
        String p = path == null ? "" : path;
        while (p.startsWith("/")) p = p.substring(1);
        String last = p.contains("/") ? p.substring(p.lastIndexOf('/') + 1) : p;
        // rutas de la app sin archivo (por ejemplo, /panel): siempre la app
        if (p.isEmpty() || !last.contains(".")) p = "index.html";
        if (p.contains("..")) return notFound();
        try {
            InputStream in = getAssets().open("www/" + p);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", p.startsWith("assets/") ? "max-age=31536000" : "no-cache");
            headers.put("Access-Control-Allow-Origin", "https://" + HOST);
            String mime = mimeOf(p);
            String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg") ? "utf-8" : null;
            return new WebResourceResponse(mime, enc, 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String p) {
        String f = p.toLowerCase();
        if (f.endsWith(".html")) return "text/html";
        if (f.endsWith(".js") || f.endsWith(".mjs")) return "application/javascript";
        if (f.endsWith(".css")) return "text/css";
        if (f.endsWith(".svg")) return "image/svg+xml";
        if (f.endsWith(".png")) return "image/png";
        if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
        if (f.endsWith(".webp")) return "image/webp";
        if (f.endsWith(".woff2")) return "font/woff2";
        if (f.endsWith(".woff")) return "font/woff";
        if (f.endsWith(".json")) return "application/json";
        if (f.endsWith(".webmanifest")) return "application/manifest+json";
        if (f.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    /** Llamadas, mapas, WhatsApp y páginas externas: con la app que corresponde del celular. */
    private void openOutside(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        Intent i;
        if ("tel".equals(scheme)) i = new Intent(Intent.ACTION_DIAL, u);
        else if ("mailto".equals(scheme)) i = new Intent(Intent.ACTION_SENDTO, u);
        else i = new Intent(Intent.ACTION_VIEW, u);
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay una app para abrir esto en tu celular.", Toast.LENGTH_SHORT).show();
        }
    }

    /* ---------------- Fotos, GPS y permisos ---------------- */

    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            boolean images = acceptsImages(params.getAcceptTypes());
            Intent pick;
            try {
                pick = params.createIntent();
            } catch (Exception e) {
                pick = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
            }
            Intent camera = null;
            cameraUri = null;
            if (images) {
                cameraUri = FilesProvider.newPhoto(MainActivity.this);
                camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                camera.setClipData(ClipData.newRawUri("foto", cameraUri));
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            Intent launch;
            if (camera != null && params.isCaptureEnabled()) {
                launch = camera;
            } else {
                launch = Intent.createChooser(pick, "Elige una foto");
                if (camera != null) launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            }
            try {
                startActivityForResult(launch, REQ_FILE);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (hasLocation()) {
                callback.invoke(origin, true, false);
                return;
            }
            geoOrigin = origin;
            geoCallback = callback;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // la app no usa micrófono ni cámara en vivo: las fotos se toman con la app de cámara
            request.deny();
        }
    }

    private static boolean acceptsImages(String[] types) {
        if (types == null || types.length == 0) return true;
        for (String t : types) {
            if (t == null || t.isEmpty() || t.startsWith("image") || t.equals("*/*")) return true;
        }
        return false;
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_VOICE) {
            ArrayList<String> found = resultCode == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
            if (found != null && !found.isEmpty() && found.get(0) != null && !found.get(0).trim().isEmpty()) heard(found.get(0), null);
            else heard(null, "No te escuchamos. Intenta otra vez, más cerca del celular.");
            return;
        }
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            Uri picked = data == null ? null : data.getData();
            if (picked != null) result = new Uri[]{picked};
            else if (cameraUri != null && FilesProvider.hasContent(this, cameraUri)) result = new Uri[]{cameraUri};
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_LOCATION || geoCallback == null) return;
        geoCallback.invoke(geoOrigin, hasLocation(), false);
        geoCallback = null;
    }

    /* ---------------- Guardar o compartir archivos (PDF y CSV) ---------------- */

    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String base64, final String filename, final String mime) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { shareFile(base64, filename, mime); }
            });
        }

        @JavascriptInterface
        public boolean canSpeak() { return ttsReady; }

        @JavascriptInterface
        public void speak(String text) {
            if (!ttsReady || tts == null) { js("window.__mesagriSpoken && window.__mesagriSpoken()"); return; }
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "mesagri");
        }

        @JavascriptInterface
        public void stopSpeaking() { if (tts != null) tts.stop(); }

        @JavascriptInterface
        public void listen() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-PE");
                    i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Habla: qué cosechaste, cuánto y a qué precio");
                    i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                    try {
                        startActivityForResult(i, REQ_VOICE);
                    } catch (Exception e) {
                        heard(null, "Tu celular no tiene dictado por voz. Escribe la frase o elige una de ejemplo.");
                    }
                }
            });
        }
    }

    private void shareFile(String base64, String filename, String mime) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            String safe = filename == null ? "mesagri" : filename.replaceAll("[^A-Za-z0-9._-]", "_");
            File dir = new File(getCacheDir(), "docs");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("sin carpeta");
            FileOutputStream out = new FileOutputStream(new File(dir, safe));
            try { out.write(bytes); } finally { out.close(); }
            Uri uri = FilesProvider.docUri(safe);
            String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent send = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(safe, uri));
            Intent chooser = Intent.createChooser(send, "Guardar o compartir " + safe);
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{view});
            startActivity(chooser);
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo guardar el archivo.", Toast.LENGTH_SHORT).show();
        }
    }

    /* ---------------- Ciclo de vida y botón atrás ---------------- */

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__mesagriBack && window.__mesagriBack()) ? 'si' : 'no'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v != null && v.contains("si")) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
