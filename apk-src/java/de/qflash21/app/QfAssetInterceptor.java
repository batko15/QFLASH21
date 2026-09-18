package de.qflash21.app;

import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * QFLASH21 v2.2.0 – Asset-Interceptor (ersetzt den Loopback-HTTP-Server v2.1.0).
 *
 * WARUM KEIN SOCKET-SERVER MEHR?
 * v2.1.0 servierte die eingebettete Web-App über http://127.0.0.1:21921.
 * Auf dem Gerät des Nutzers blieb die WebView dadurch WEIß: Der Chromium-
 * Netzwerk-Stack der WebView erreicht den Loopback-Server nicht immer
 * (bekanntes Cleartext/localhost-Thema, ROM-/VPN-/Firewall-Interferenz,
 * siehe Google-Issue „WebView Blocking Cleartext HTTP Traffic to localhost"
 * und chromium.org #40933016). Ohne onReceivedError-Handler blieb die Fläche
 * weiß statt einer Meldung.
 *
 * DIE LÖSUNG (offizielles Muster, wie androidx.webkit WebViewAssetLoader):
 * Requests werden in WebViewClient.shouldInterceptRequest ABGEFANGEN und
 * direkt aus dem AssetManager der APK beantwortet. Es fließt KEIN einziges
 * Netzwerk-Paket mehr: kein Port, kein Socket, kein Cleartext, keine
 * VPN-/Firewall-Interferenz, kein DNS. Die App ist damit zu 100 % offline
 * und strukturell immun gegen die v2.1.0-Ausfallklasse.
 *
 * Die virtuelle Herkunft ist https://appassets.androidplatform.net/ –
 * dieselbe Domain, die Google für diesen Zweck reserviert hat
 * (WebViewAssetLoader.DEFAULT_DOMAIN). Dadurch: Secure Context (Clipboard,
 * crypto, localStorage), Same-Origin-Policy intakt, kein DNS-Lookup nötig
 * (Interception passiert VOR dem Netzwerk-Stack).
 *
 * API-Endpunkte (/api/logs, /api/analyze-dtc) laufen über die
 * JavascriptInterface-Brücke QfNativeApi, denn shouldInterceptRequest stellt
 * den POST-Body nicht bereit – das ist dokumentiertes Verhalten.
 */
public final class QfAssetInterceptor {

    /** Virtuelle Domain der App-Oberfläche (Google-reserviert für dieses Muster). */
    public static final String APP_HOST = "appassets.androidplatform.net";
    public static final String START_URL = "https://" + APP_HOST + "/";

    private static final String WWW_PREFIX = "www";
    /** Legacy: v2.1.0-Origin mitliefern, falls etwas daraus gecached ist. */
    private static final String LEGACY_HOST_PREFIX = "127.0.0.1";

    private final AssetManager am;

    public QfAssetInterceptor(AssetManager assetManager) {
        this.am = assetManager;
    }

    /** Soll diese Anfrage von uns bedient werden? (unser Host oder Legacy-Loopback) */
    public boolean isAppUrl(Uri url) {
        if (url == null) return false;
        String host = url.getHost();
        if (host == null) return false;
        String h = host.toLowerCase(Locale.US);
        return APP_HOST.equals(h) || h.equals(LEGACY_HOST_PREFIX) || h.endsWith("." + LEGACY_HOST_PREFIX);
    }

    /**
     * Bedient eine App-Anfrage aus der APK. Rückgabe null → WebView soll normal
     * weitermachen (sollte für App-URLs nie passieren, aber defensiv bleiben).
     */
    public WebResourceResponse intercept(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path == null || path.length() == 0) path = "/";

        // Pfad-Normalisierung: decode %xx (Asset-Namen sind ASCII), doppelte Slashes glätten
        try {
            String decoded = java.net.URLDecoder.decode(path, "UTF-8");
            if (!decoded.contains("..")) path = decoded;
        } catch (Throwable ignored) {
            // Originalpfad behalten
        }
        while (path.contains("//")) {
            path = path.replace("//", "/");
        }
        if (path.contains("..")) {
            return textResponse(403, "Forbidden", "Pfad nicht erlaubt");
        }

        // API-Endpunkte: bewusst via QfNativeApi (POST-Body ist hier nicht verfügbar)
        if (path.startsWith("/api/")) {
            return jsonResponse(501, "{\"error\":\"Nutze window.QfNativeApi (App-Modus)\"}");
        }
        if (path.equals("/sw.js")) {
            // Kein Service Worker in der Standalone-App (alles ist lokal → nur Stale-Risiko)
            return textResponse(404, "Not Found", "kein Service Worker (Standalone-App)");
        }
        if (path.startsWith("/apk/")) {
            return htmlResponse(apkInfoPage());
        }

        // Asset-Pfad auflösen: "/" → www/index.html; endungslos → SPA-Fallback
        String assetPath = WWW_PREFIX + path;
        if (path.equals("/") || path.endsWith("/")) {
            assetPath = WWW_PREFIX + path + "index.html";
        }
        byte[] data = readAsset(assetPath);
        if (data == null && !hasExtension(path)) {
            data = readAsset(WWW_PREFIX + "/index.html"); // SPA-Routing-Fallback
        }
        if (data == null) {
            return textResponse(404, "Not Found", "Nicht gefunden: " + path);
        }

        String cache = path.startsWith("/_next/static/")
                ? "public, max-age=31536000, immutable" : "no-cache";
        return response(200, "OK", mime(path), cache, data);
    }

    /* ------------------------- interne Helfer ------------------------- */

    private static boolean hasExtension(String path) {
        int slash = path.lastIndexOf('/');
        int dot = path.lastIndexOf('.');
        return dot > slash && dot < path.length() - 1;
    }

    private byte[] readAsset(String path) {
        try {
            InputStream in = am.open(path, AssetManager.ACCESS_STREAMING);
            try {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] tmp = new byte[16384];
                int n;
                while ((n = in.read(tmp)) > 0) {
                    buf.write(tmp, 0, n);
                }
                return buf.toByteArray();
            } finally {
                try {
                    in.close();
                } catch (IOException ignored) {
                    // egal
                }
            }
        } catch (IOException e) {
            return null;
        }
    }

    private String mime(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf") || p.endsWith(".otf")) return "font/ttf";
        if (p.endsWith(".zip")) return "application/zip";
        if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    private WebResourceResponse response(int code, String reason, String mimeType,
                                         String cacheControl, byte[] data) {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", cacheControl);
        WebResourceResponse r = new WebResourceResponse(mimeType, "utf-8", code, reason, headers,
                new ByteArrayInputStream(data));
        return r;
    }

    private WebResourceResponse textResponse(int code, String reason, String msg) {
        return response(code, reason, "text/plain; charset=utf-8", "no-store",
                ("QFLASH21 Standalone: " + msg).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private WebResourceResponse jsonResponse(int code, String json) {
        return response(code, statusText(code), "application/json", "no-store",
                json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private WebResourceResponse htmlResponse(String html) {
        return response(200, "OK", "text/html; charset=utf-8", "no-store",
                html.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private static String statusText(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 501: return "Not Implemented";
            default: return "Error";
        }
    }

    private static String apkInfoPage() {
        return "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>QFLASH21</title></head>"
                + "<body style=\"font-family:sans-serif;background:#09090b;color:#fafafa;"
                + "display:grid;place-items:center;min-height:100vh;margin:0\">"
                + "<div style=\"max-width:28rem;text-align:center;padding:2rem\">"
                + "<h1 style=\"font-size:1.5rem;margin-bottom:.5rem\">QFLASH21 Standalone</h1>"
                + "<p>Du bist bereits <b>in der App</b> – dieser Download ist hier nicht nötig.</p>"
                + "<p style=\"color:#a1a1aa;font-size:.9rem\">Neue Versionen: qflashk.vercel.app/apk/</p>"
                + "</div></body></html>";
    }

    /** Für Diagnose: WebView-Version ins Fehlerbild aufnehmen. */
    public static String webviewInfo() {
        try {
            return "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";
        } catch (Throwable t) {
            return "unbekannt";
        }
    }
}
