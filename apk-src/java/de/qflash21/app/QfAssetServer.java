package de.qflash21.app;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicLong;

/**
 * QFLASH21 v2.1.0 STANDALONE – lokaler Asset-Webserver.
 *
 * Serviert die KOMPLETT in die APK eingebettete Web-App (assets/www/) über
 * http://127.0.0.1:&lt;Port&gt; an die WebView. Dadurch ist die App zu 100 %
 * eigenständig: kein Internet, kein Chrome, keine Website nötig – die gesamte
 * Oberfläche inkl. aller Daten (auch DeepOBD-Konfigs) ist an Bord.
 *
 * Zusätzlich implementiert der Server die API-Endpunkte lokal (die Website
 * braucht dafür sonst ein Backend):
 *  - GET/POST /api/logs        → lokale Operationshistorie (Datei im App-Speicher)
 *  - POST /api/analyze-dtc     → offline-Werkstatt-Hinweise (Regelbasiert)
 *
 * Aus Sicherheitsgründen wird NUR auf 127.0.0.1 gebunden; Pfad-Traversale
 * (..) wird blockiert. Fester Port bevorzugt, damit localStorage (Einstellungen)
 * zwischen App-Starts erhalten bleibt (Origin = Host:Port).
 */
public class QfAssetServer {

    /** Bevorzugte feste Ports (falls belegt → nächste, sonst beliebiger). */
    private static final int[] PREFERRED_PORTS = {21921, 21922, 21923, 21924, 21925};

    private static final String WWW_PREFIX = "www";

    private final Context ctx;
    private final AssetManager am;
    private ServerSocket serverSocket;
    private volatile int port = -1;
    private volatile boolean running = false;
    private final Object logLock = new Object();
    private File logFile;
    private final AtomicLong idCounter = new AtomicLong();

    /** Offline-Hinweise für /api/analyze-dtc (identisch zum Server-Fallback der Website). */
    private static final Map<String, String> DTC_HINTS = new HashMap<String, String>();
    static {
        DTC_HINTS.put("00025", "Luftmassenmesser (HFM): Prüfen Sie Stecker/Korrosion. Typische Folge: Rauchentwicklung, Leistungsabfall, Notlaufprogramm.");
        DTC_HINTS.put("00064", "Laderdruckregelung: Laderschlauch auf Leckagen prüfen, Wastegate/Stellglied bewegen. Häufig Undichtigkeit oder verkoktes VTG.");
        DTC_HINTS.put("17964", "Ladedruck zu niedrig: Nebenluft bzw. geplatzte Laderschlauchleitung prüfen. Auch AGR-Undichtigkeit möglich.");
        DTC_HINTS.put("00087", "AGR-Ventil: AGR-Kühler/Ventil auf Verkokung prüfen, Stellglied ansteuern. Häufig bei hoher Laufleistung.");
        DTC_HINTS.put("00438", "Kurbelwellensensor: Kein Signal → Motor startet nicht. Sensorwechsel, Prüfen auf Metallspäne am Geber.");
        DTC_HINTS.put("01795", "Interne Steuergeräte-Störung: EEPROM/Programmspeicher defekt – Reparatur oder Tauschgerät nötig.");
    }

    public QfAssetServer(Context context) {
        Context app = context.getApplicationContext();
        this.ctx = app;
        this.am = app.getAssets();
    }

    /** Startet den Server. Rückgabe: gebundener Port. */
    public int start() throws IOException {
        logFile = new File(ctx.getFilesDir(), "operation-log.json");
        IOException last = null;
        for (int p : PREFERRED_PORTS) {
            try {
                bind(p);
                return port;
            } catch (IOException e) {
                last = e;
            }
        }
        bind(0); // beliebiger freier Port (localStorage geht dann ggf. verloren – akzeptabler Sonderfall)
        return port;
    }

    private void bind(int portHint) throws IOException {
        serverSocket = new ServerSocket(portHint, 64, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        running = true;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "QfAssetServer");
        t.setDaemon(true);
        t.start();
    }

    public int getPort() {
        return port;
    }

    public void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (Throwable ignored) {
                // egal
            }
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = serverSocket.accept();
                Thread h = new Thread(new Runnable() {
                    @Override
                    public void run() {
                        handle(s);
                    }
                }, "QfConn");
                h.setDaemon(true);
                h.start();
            } catch (Throwable e) {
                if (running) {
                    sleep(50);
                }
            }
        }
    }

    private void handle(Socket s) {
        try {
            s.setSoTimeout(10000);
            s.setTcpNoDelay(true);
            String head = readHeaders(s);
            if (head == null) {
                writeSimple(s, 400, "Bad Request");
                return;
            }
            String[] lines = head.split("\r\n");
            String[] parts = lines[0].split(" ");
            if (parts.length < 2) {
                writeSimple(s, 400, "Bad Request");
                return;
            }
            String method = parts[0];
            String target = parts[1];

            int contentLength = 0;
            for (int i = 1; i < lines.length; i++) {
                int c = lines[i].indexOf(':');
                if (c <= 0) continue;
                String k = lines[i].substring(0, c).trim().toLowerCase(Locale.US);
                String v = lines[i].substring(c + 1).trim();
                if ("content-length".equals(k)) {
                    try {
                        contentLength = Integer.parseInt(v);
                    } catch (NumberFormatException ignored) {
                        // ohne Body
                    }
                }
            }
            byte[] body = contentLength > 0 ? readFully(s.getInputStream(), contentLength) : new byte[0];

            String path = target;
            String query = "";
            int q = path.indexOf('?');
            if (q >= 0) {
                query = path.substring(q + 1);
                path = path.substring(0, q);
            }
            try {
                path = URLDecoder.decode(path, "UTF-8");
            } catch (Throwable ignored) {
                // dekodierten Pfad behalten
            }
            if (!path.startsWith("/")) path = "/" + path;
            if (path.contains("..")) {
                writeSimple(s, 403, "Forbidden");
                return;
            }

            if (path.startsWith("/api/")) {
                handleApi(s, method, path, query, body);
            } else if (path.equals("/sw.js")) {
                // Bewusst 404: In der Standalone-App ist kein Service Worker nötig
                // (alles ist lokal) – er würde nur Stale-Cache-Risiken bringen.
                writeSimple(s, 404, "Not Found");
            } else if (path.startsWith("/apk/")) {
                String msg = "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
                        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                        + "<title>QFLASH21</title></head>"
                        + "<body style=\"font-family:sans-serif;background:#09090b;color:#fafafa;"
                        + "display:grid;place-items:center;min-height:100vh;margin:0\">"
                        + "<div style=\"max-width:28rem;text-align:center;padding:2rem\">"
                        + "<h1 style=\"font-size:1.5rem;margin-bottom:.5rem\">QFLASH21 Standalone</h1>"
                        + "<p>Du bist bereits <b>in der App</b> – dieser Download ist hier nicht nötig.</p>"
                        + "<p style=\"color:#a1a1aa;font-size:.9rem\">Neue Versionen: qflashk.vercel.app/apk/</p>"
                        + "</div></body></html>";
                writeResponse(s, 200, "OK", "text/html; charset=utf-8", "no-store",
                        msg.getBytes(StandardCharsets.UTF_8), false);
            } else {
                serveAsset(s, method, path);
            }
        } catch (Throwable e) {
            try {
                s.close();
            } catch (Throwable ignored) {
                // egal
            }
        }
    }

    /* ----------------------------- Assets ----------------------------- */

    private void serveAsset(Socket s, String method, String path) throws IOException {
        String assetPath = WWW_PREFIX + path;
        if (path.equals("/") || path.endsWith("/")) {
            assetPath = WWW_PREFIX + path + "index.html";
        }
        byte[] data = readAsset(assetPath);
        if (data == null && assetPath.endsWith("/index.html")) {
            // SPA-Fallback: unbekannte endungslose Pfade → index.html
            data = readAsset(WWW_PREFIX + "/index.html");
        }
        if (data == null) {
            writeSimple(s, 404, "Nicht gefunden (lokale Standalone-App)");
            return;
        }
        String cache = path.startsWith("/_next/static/")
                ? "public, max-age=31536000, immutable" : "no-cache";
        writeResponse(s, 200, "OK", mime(path), cache, data, "HEAD".equals(method));
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

    /* ------------------------------- API ------------------------------ */

    private void handleApi(Socket s, String method, String path, String query, byte[] body)
            throws IOException {
        if ("/api/logs".equals(path)) {
            if ("POST".equals(method)) {
                handleLogsPost(s, body);
            } else if ("GET".equals(method)) {
                handleLogsGet(s, query);
            } else {
                writeSimple(s, 405, "Method Not Allowed");
            }
            return;
        }
        if ("/api/analyze-dtc".equals(path) && "POST".equals(method)) {
            handleAnalyzeDtc(s, body);
            return;
        }
        writeJson(s, 404, "{\"error\":\"Unbekannter Endpunkt (lokale Standalone-App)\"}");
    }

    private void handleLogsPost(Socket s, byte[] body) throws IOException {
        try {
            JSONObject in = new JSONObject(new String(body, StandardCharsets.UTF_8));
            String operation = optStringMax(in, "operation", 64);
            if (operation.length() == 0) {
                writeJson(s, 400, "{\"error\":\"operation fehlt\"}");
                return;
            }
            String status = "ERROR".equals(in.optString("status")) ? "ERROR" : "OK";
            JSONObject entry = new JSONObject();
            entry.put("id", "local-" + System.currentTimeMillis() + "-" + idCounter.incrementAndGet());
            entry.put("operation", operation);
            entry.put("status", status);
            entry.put("vehicle", in.has("vehicle") ? (Object) optStringMax(in, "vehicle", 64) : JSONObject.NULL);
            entry.put("ecuType", in.has("ecuType") ? (Object) optStringMax(in, "ecuType", 128) : JSONObject.NULL);
            entry.put("details", in.has("details") ? (Object) detailString(in) : JSONObject.NULL);
            entry.put("durationMs", in.has("durationMs") && !in.isNull("durationMs")
                    ? (Object) Math.round(in.optDouble("durationMs", 0)) : JSONObject.NULL);
            entry.put("createdAt", isoNow());

            synchronized (logLock) {
                JSONArray logs = readLogsLocked();
                JSONArray next = new JSONArray();
                next.put(entry);
                for (int i = 0; i < logs.length() && i < 499; i++) {
                    next.put(logs.get(i));
                }
                saveLogsLocked(next);
            }
            JSONObject resp = new JSONObject();
            resp.put("id", entry.getString("id"));
            resp.put("ok", true);
            writeJson(s, 201, resp.toString());
        } catch (Throwable e) {
            writeJson(s, 400, "{\"error\":\"Ungültiger Log-Body\"}");
        }
    }

    private void handleLogsGet(Socket s, String query) throws IOException {
        int limit = 50;
        try {
            Map<String, String> params = parseQuery(query);
            String l = params.get("limit");
            if (l != null) {
                int n = Integer.parseInt(l);
                limit = Math.min(Math.max(n, 1), 200);
            }
        } catch (Throwable ignored) {
            // Standard-Limit
        }
        try {
            String logsJson;
            synchronized (logLock) {
                JSONArray logs = readLogsLocked();
                JSONArray out = new JSONArray();
                for (int i = 0; i < logs.length() && i < limit; i++) {
                    out.put(logs.get(i));
                }
                JSONObject resp = new JSONObject();
                resp.put("logs", out);
                resp.put("stats", logStats(logs));
                logsJson = resp.toString();
            }
            writeJson(s, 200, logsJson);
        } catch (Throwable e) {
            writeJson(s, 500, "{\"error\":\"Logs konnten nicht gelesen werden\"}");
        }
    }

    private void handleAnalyzeDtc(Socket s, byte[] body) throws IOException {
        try {
            JSONObject in = new JSONObject(new String(body, StandardCharsets.UTF_8));
            JSONArray dtcs = in.has("dtcs") && in.get("dtcs") instanceof JSONArray
                    ? in.getJSONArray("dtcs") : new JSONArray();
            if (dtcs.length() == 0) {
                writeJson(s, 200, "{\"analysis\":\"Keine Fehlercodes vorhanden.\",\"source\":\"fallback\"}");
                return;
            }
            StringBuilder sb = new StringBuilder("Werkstatt-Hinweise (offline):\n\n");
            int count = Math.min(dtcs.length(), 12);
            for (int i = 0; i < count; i++) {
                JSONObject d = dtcs.optJSONObject(i);
                if (d == null) continue;
                String code = d.optString("code", "?");
                String desc = d.optString("description", "");
                String hint = DTC_HINTS.get(code);
                sb.append("• ").append(code).append(" – ").append(desc).append("\n  ");
                sb.append(hint != null ? hint
                        : "Allgemeine Diagnose: Verkabelung, Massepunkte und Sensorversorgung prüfen; "
                        + "im Zweifel Komponententest per Live-Daten.");
                sb.append("\n\n");
            }
            JSONObject resp = new JSONObject();
            resp.put("analysis", sb.toString().trim());
            resp.put("source", "fallback");
            writeJson(s, 200, resp.toString());
        } catch (Throwable e) {
            writeJson(s, 400, "{\"error\":\"Ungültiger Analyse-Body\"}");
        }
    }

    /* --------------------------- Log-Speicher -------------------------- */

    private JSONArray readLogsLocked() {
        try {
            if (logFile.exists() && logFile.length() > 0) {
                return new JSONArray(readFile(logFile));
            }
        } catch (Throwable ignored) {
            // defekte Datei → neu beginnen
        }
        return new JSONArray();
    }

    private void saveLogsLocked(JSONArray logs) {
        try {
            File tmp = new File(ctx.getFilesDir(), "operation-log.json.tmp");
            writeString(tmp, logs.toString());
            if (!tmp.renameTo(logFile)) {
                writeString(logFile, logs.toString());
            }
        } catch (Throwable ignored) {
            // Logging darf niemals crashen
        }
    }

    /** Gruppiert Zählungen nach operation+status (Shape wie die Server-API). */
    private JSONArray logStats(JSONArray logs) {
        Map<String, Integer> counts = new HashMap<String, Integer>();
        for (int i = 0; i < logs.length(); i++) {
            JSONObject l = logs.optJSONObject(i);
            if (l == null) continue;
            String key = l.optString("operation", "?") + "|" + l.optString("status", "OK");
            Integer prev = counts.get(key);
            counts.put(key, prev == null ? 1 : prev + 1);
        }
        JSONArray out = new JSONArray();
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            try {
                int bar = e.getKey().indexOf('|');
                JSONObject stat = new JSONObject();
                stat.put("operation", e.getKey().substring(0, bar));
                stat.put("status", e.getKey().substring(bar + 1));
                JSONObject cnt = new JSONObject();
                cnt.put("_all", e.getValue());
                stat.put("_count", cnt);
                out.put(stat);
            } catch (Throwable ignored) {
                // Statistik ist optional
            }
        }
        return out;
    }

    /* ----------------------------- Helfer ------------------------------ */

    private static String optStringMax(JSONObject o, String key, int max) {
        String v = o.optString(key, "");
        return v.length() > max ? v.substring(0, max) : v;
    }

    private static String detailString(JSONObject in) {
        try {
            Object d = in.get("details");
            String s = d instanceof String ? (String) d : String.valueOf(d);
            return s.length() > 4000 ? s.substring(0, 4000) : s;
        } catch (Throwable e) {
            return null;
        }
    }

    private static String isoNow() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date()) + "." + String.format(Locale.US, "%03d",
                System.currentTimeMillis() % 1000) + "Z";
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> out = new HashMap<String, String>();
        if (query == null || query.length() == 0) return out;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            try {
                out.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"),
                        URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
            } catch (Throwable ignored) {
                // Paar überspringen
            }
        }
        return out;
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
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".zip")) return "application/zip";
        if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    private String readHeaders(Socket s) throws IOException {
        InputStream in = s.getInputStream();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b1 = -1, b2 = -1, b3 = -1, c;
        while ((c = in.read()) != -1) {
            buf.write(c);
            if (b1 == '\r' && b2 == '\n' && b3 == '\r' && c == '\n') break;
            b1 = b2;
            b2 = b3;
            b3 = c;
            if (buf.size() > 32768) return null;
        }
        return new String(buf.toByteArray(), StandardCharsets.US_ASCII);
    }

    private byte[] readFully(InputStream in, int len) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(Math.max(64, len));
        byte[] tmp = new byte[8192];
        int remaining = len;
        while (remaining > 0) {
            int n = in.read(tmp, 0, Math.min(tmp.length, remaining));
            if (n < 0) break;
            buf.write(tmp, 0, n);
            remaining -= n;
        }
        return buf.toByteArray();
    }

    private static String readFile(File f) throws IOException {
        InputStream in = new java.io.FileInputStream(f);
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[8192];
            int n;
            while ((n = in.read(tmp)) > 0) {
                buf.write(tmp, 0, n);
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            try {
                in.close();
            } catch (IOException ignored) {
                // egal
            }
        }
    }

    private static void writeString(File f, String content) throws IOException {
        OutputStream out = new java.io.FileOutputStream(f);
        try {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } finally {
            try {
                out.close();
            } catch (IOException ignored) {
                // egal
            }
        }
    }

    private void writeResponse(Socket s, int code, String status, String mime, String cache,
                               byte[] data, boolean headOnly) throws IOException {
        OutputStream out = s.getOutputStream();
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(' ').append(status).append("\r\n");
        h.append("Content-Type: ").append(mime).append("\r\n");
        h.append("Content-Length: ").append(data.length).append("\r\n");
        if (cache != null) {
            h.append("Cache-Control: ").append(cache).append("\r\n");
        }
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.US_ASCII));
        if (!headOnly && data.length > 0) {
            out.write(data);
        }
        out.flush();
        s.close();
    }

    private void writeJson(Socket s, int code, String json) throws IOException {
        writeResponse(s, code, statusText(code), "application/json", "no-store",
                json.getBytes(StandardCharsets.UTF_8), false);
    }

    private void writeSimple(Socket s, int code, String msg) throws IOException {
        writeResponse(s, code, statusText(code), "text/plain; charset=utf-8", "no-store",
                ("QFLASH21 Standalone: " + msg).getBytes(StandardCharsets.UTF_8), false);
    }

    private static String statusText(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            default: return "Error";
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
