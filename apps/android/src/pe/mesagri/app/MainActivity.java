package pe.mesagri.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
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
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Mesagri para Android.
 * - Con servidor (BuildInfo.SERVER o el que se elija en la pantalla de conexión): abre la app del
 *   servidor de Mesagri en la nube. Todos ven lo mismo según su perfil y en vivo. Mientras el servidor
 *   despierta (el plan gratis se duerme sin uso) muestra una pantalla de conexión.
 * - Sin internet: «probar sin internet» abre la versión autónoma que viene en el APK (assets/www), con
 *   datos de ejemplo guardados en el celular, desde una dirección https propia del celular
 *   (https://appassets.androidplatform.net).
 * En los dos casos usa el GPS, la cámara, el micrófono y los archivos como una app normal: pide cada
 * permiso cuando hace falta (y todos juntos desde «Permisos de la app»). Lo que no es de la app
 * (llamadas, mapas, WhatsApp) se abre afuera.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final String CONNECT = "https://" + HOST + "/conexion.html";
    private static final String PREFS = "mesagri";
    private static final int REQ_FILE = 11;
    private static final int REQ_LOCATION = 12;
    private static final int REQ_VOICE = 13;
    private static final int REQ_CAMERA = 14;
    private static final int REQ_MIC = 15;
    private static final int REQ_ASK = 16;
    private static final int REQ_WEB = 17;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    /** Selector de fotos que espera la respuesta al permiso de la cámara. */
    private Intent pendingPick;
    private boolean pendingCapture;
    /** Pedido de cámara o micrófono en vivo de la página (getUserMedia) que espera el permiso. */
    private PermissionRequest pendingWeb;
    private SpeechRecognizer recognizer;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private TextToSpeech tts;
    private boolean ttsReady;
    /** Servidor de Mesagri (vacío: solo la versión autónoma). */
    private String server = "";
    /** Intento de conexión en curso (cada intento nuevo deja sin efecto al anterior). */
    private volatile int attempt;

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

        server = cleanServer(getSharedPreferences(PREFS, MODE_PRIVATE).getString("server", BuildInfo.SERVER));
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null || CONNECT.equals(web.getUrl())) { if (server.isEmpty()) openLocal(); else connect(); }
        startVoice();
    }

    /* ---------------- Servidor en la nube ---------------- */

    private static String cleanServer(String s) {
        if (s == null) return "";
        String v = s.trim();
        while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
        Uri u = Uri.parse(v);
        if (u.getHost() == null || !("https".equals(u.getScheme()) || "http".equals(u.getScheme()))) return "";
        return v;
    }

    private boolean isServer(Uri u) {
        if (server.isEmpty() || u == null) return false;
        Uri s = Uri.parse(server);
        return s.getHost() != null && s.getHost().equalsIgnoreCase(u.getHost()) && s.getScheme() != null && s.getScheme().equals(u.getScheme()) && s.getPort() == u.getPort();
    }

    private boolean online() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
            return n != null && n.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    /** Pantalla de conexión y, por detrás, se pregunta al servidor si ya está listo (despierta en hasta un minuto). */
    private void connect() {
        final int me = ++attempt;
        web.loadUrl(CONNECT);
        if (server.isEmpty()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                int offline = 0;
                for (int i = 1; i <= 45 && me == attempt; i++) {
                    if (!online()) {
                        if (++offline >= 2) { if (me == attempt) js("window.__mesagri && __mesagri.offline()"); return; }
                    } else {
                        offline = 0;
                        if (healthy()) {
                            if (me != attempt) return;
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() { if (me == attempt) web.loadUrl(server + "/"); }
                            });
                            return;
                        }
                        if (me == attempt) js("window.__mesagri && __mesagri.waiting(" + i + ")");
                    }
                    try { Thread.sleep(2500); } catch (InterruptedException e) { return; }
                }
                if (me == attempt) js("window.__mesagri && __mesagri.failed()");
            }
        }).start();
    }

    /** ¿El servidor de Mesagri responde y su base de datos está lista? */
    private boolean healthy() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(server + "/api/v1/health").openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "MesagriApp/" + BuildInfo.VERSION);
            if (c.getResponseCode() != 200) return false;
            InputStream in = c.getInputStream();
            byte[] buf = new byte[4096];
            int n = in.read(buf);
            in.close();
            String body = n > 0 ? new String(buf, 0, n, "UTF-8") : "";
            return body.contains("\"ok\":true");
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Versión autónoma (viene en el APK): datos de ejemplo guardados en este celular, sin internet. */
    private void openLocal() {
        attempt++;
        web.loadUrl(START);
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
            if (isServer(u)) return false;
            openOutside(u);
            return true;
        }

        /** Se cortó la señal o el servidor se reinicia: se vuelve a la pantalla de conexión. */
        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isServer(request.getUrl())) connect();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && isServer(request.getUrl()) && response.getStatusCode() >= 500) connect();
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
            boolean capture = params.isCaptureEnabled();
            if (images && capture && !granted(Manifest.permission.CAMERA)) {
                // «Tomar foto»: primero el permiso de la cámara; con la respuesta se abre la cámara o la galería
                pendingPick = pick;
                pendingCapture = true;
                ask(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                return true;
            }
            // «Elegir de la galería»: la cámara aparece como opción solo si ya hay permiso
            return launchChooser(pick, capture, images && granted(Manifest.permission.CAMERA));
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
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { webPermission(request); }
            });
        }
    }

    /** Abre la cámara (si hay permiso) o el selector de fotos de la galería. */
    private boolean launchChooser(Intent pick, boolean capture, boolean withCamera) {
        Intent camera = null;
        cameraUri = null;
        if (withCamera) {
            cameraUri = FilesProvider.newPhoto(MainActivity.this);
            camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.setClipData(ClipData.newRawUri("foto", cameraUri));
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        Intent launch;
        if (camera != null && capture) {
            launch = camera;
        } else {
            launch = Intent.createChooser(pick, "Elige una foto");
            if (camera != null) launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(launch, REQ_FILE);
            return true;
        } catch (Exception e) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
            return false;
        }
    }

    /** Cámara o micrófono en vivo para la página de Mesagri (nunca para otras páginas). */
    private void webPermission(PermissionRequest request) {
        Uri origin = request.getOrigin();
        boolean ours = origin != null && (HOST.equals(origin.getHost()) || isServer(origin));
        if (!ours) { request.deny(); return; }
        ArrayList<String> need = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !granted(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !granted(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
        }
        if (need.isEmpty()) { grantWeb(request); return; }
        if (pendingWeb != null) pendingWeb.deny();
        pendingWeb = request;
        ask(need.toArray(new String[0]), REQ_WEB);
    }

    private void grantWeb(PermissionRequest request) {
        ArrayList<String> ok = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && granted(Manifest.permission.CAMERA)) ok.add(r);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && granted(Manifest.permission.RECORD_AUDIO)) ok.add(r);
        }
        if (ok.isEmpty()) request.deny(); else request.grant(ok.toArray(new String[0]));
    }

    /* ---------------- Permisos del celular ---------------- */

    private boolean granted(String perm) { return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED; }

    /** Pide permisos y recuerda que ya se pidieron (para saber si quedaron bloqueados). */
    private void ask(String[] perms, int code) {
        android.content.SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        for (String p : perms) e.putBoolean("pedido:" + p, true);
        e.apply();
        requestPermissions(perms, code);
    }

    /** granted · prompt (aún no se pidió) · denied (se puede pedir otra vez) · blocked (solo desde los ajustes del celular). */
    private String state(String perm) {
        if (granted(perm)) return "granted";
        boolean asked = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("pedido:" + perm, false);
        if (!asked) return "prompt";
        return shouldShowRequestPermissionRationale(perm) ? "denied" : "blocked";
    }

    private String locationState() {
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)) return "granted";
        return state(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private String permissionsJson() {
        return "{\"camera\":\"" + state(Manifest.permission.CAMERA) + "\",\"microphone\":\"" + state(Manifest.permission.RECORD_AUDIO) + "\",\"location\":\"" + locationState() + "\"}";
    }

    private static String[] androidPerms(String name) {
        if ("camera".equals(name)) return new String[]{Manifest.permission.CAMERA};
        if ("microphone".equals(name)) return new String[]{Manifest.permission.RECORD_AUDIO};
        if ("location".equals(name)) return new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
        return new String[0];
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
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null;
        } else if (requestCode == REQ_CAMERA && pendingPick != null) {
            boolean cam = granted(Manifest.permission.CAMERA);
            if (!cam) Toast.makeText(this, "Sin permiso de la cámara: elige una foto de tu galería.", Toast.LENGTH_LONG).show();
            Intent pick = pendingPick;
            pendingPick = null;
            launchChooser(pick, pendingCapture && cam, cam);
        } else if (requestCode == REQ_MIC) {
            if (granted(Manifest.permission.RECORD_AUDIO)) startListening();
            else heard(null, "Sin permiso del micrófono no podemos escucharte. Escribe la frase, o permite el micrófono en Perfil → Permisos de la app.");
        } else if (requestCode == REQ_WEB && pendingWeb != null) {
            grantWeb(pendingWeb);
            pendingWeb = null;
        } else if (requestCode == REQ_ASK) {
            js("window.__mesagriPermissions && window.__mesagriPermissions(" + quote(permissionsJson()) + ")");
        }
    }

    /* ---------------- Guardar o compartir archivos (PDF y CSV) ---------------- */

    private class Bridge {
        /** Dirección del servidor de Mesagri ('' si el APK es solo autónomo). */
        @JavascriptInterface
        public String server() { return server; }

        @JavascriptInterface
        public String version() { return BuildInfo.VERSION; }

        /** Pantalla de conexión: intentar otra vez. Versión autónoma: volver a la versión en línea. */
        @JavascriptInterface
        public void goOnline() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { if (server.isEmpty()) openLocal(); else connect(); }
            });
        }

        /** Probar sin internet: la versión autónoma con datos de ejemplo. */
        @JavascriptInterface
        public void openOffline() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { openLocal(); }
            });
        }

        /** Otro servidor (por ejemplo, si la dirección de la nube cambió). Vacío: el que trae el APK. */
        @JavascriptInterface
        public boolean setServer(String url) {
            final String v = url == null || url.trim().isEmpty() ? cleanServer(BuildInfo.SERVER) : cleanServer(url);
            if (v.isEmpty() && url != null && !url.trim().isEmpty()) return false;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("server", v).apply();
            runOnUiThread(new Runnable() {
                @Override
                public void run() { server = v; if (server.isEmpty()) openLocal(); else connect(); }
            });
            return true;
        }

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

        /** Escucha una frase: primero el permiso del micrófono; luego el dictado dentro de la app. */
        @JavascriptInterface
        public void listen() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (granted(Manifest.permission.RECORD_AUDIO)) startListening();
                    else ask(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                }
            });
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { if (recognizer != null) recognizer.stopListening(); }
            });
        }

        /** Estado de los permisos: {"camera": "granted|prompt|denied|blocked", "microphone": …, "location": …}. */
        @JavascriptInterface
        public String permissions() { return permissionsJson(); }

        /** Pide los permisos (camera, microphone, location separados por comas) en un solo cuadro del celular. */
        @JavascriptInterface
        public void askPermissions(final String names) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ArrayList<String> need = new ArrayList<>();
                    for (String n : (names == null ? "" : names).split(",")) {
                        for (String p : androidPerms(n.trim())) if (!granted(p) && !need.contains(p)) need.add(p);
                    }
                    if (need.isEmpty()) js("window.__mesagriPermissions && window.__mesagriPermissions(" + quote(permissionsJson()) + ")");
                    else ask(need.toArray(new String[0]), REQ_ASK);
                }
            });
        }

        /** Ajustes de Mesagri en el celular (para un permiso que quedó bloqueado). */
        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Abre Ajustes → Apps → Mesagri → Permisos.", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
    }

    /** Dictado dentro de la app (con el reconocedor de voz del celular); si no hay, la ventana de dictado de Google. */
    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { dictationDialog(); return; }
        try {
            if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { js("window.__mesagriListening && window.__mesagriListening(true)"); }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float v) { }
                @Override public void onBufferReceived(byte[] b) { }
                @Override public void onEndOfSpeech() { js("window.__mesagriListening && window.__mesagriListening(false)"); }
                @Override public void onEvent(int t, Bundle b) { }
                @Override
                public void onPartialResults(Bundle b) {
                    ArrayList<String> p = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (p != null && !p.isEmpty() && p.get(0) != null && !p.get(0).trim().isEmpty()) js("window.__mesagriPartial && window.__mesagriPartial(" + quote(p.get(0)) + ")");
                }
                @Override
                public void onResults(Bundle b) {
                    ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (r != null && !r.isEmpty() && r.get(0) != null && !r.get(0).trim().isEmpty()) heard(r.get(0), null);
                    else heard(null, "No te escuchamos. Intenta otra vez, más cerca del celular.");
                }
                @Override
                public void onError(int e) {
                    if (e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) heard(null, "Sin permiso del micrófono no podemos escucharte. Permítelo en Perfil → Permisos de la app.");
                    else if (e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_SERVER) heard(null, "Para entender la voz hace falta internet. Escribe la frase o inténtalo con señal.");
                    else heard(null, "No te escuchamos. Intenta otra vez, más cerca del celular.");
                }
            });
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-PE");
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            recognizer.startListening(i);
        } catch (Exception e) {
            dictationDialog();
        }
    }

    /** Ventana de dictado del sistema (celulares sin reconocedor de voz para apps). */
    private void dictationDialog() {
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
        if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
