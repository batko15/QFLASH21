package de.qflash21.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicLong;

/**
 * QFLASH21 v2.2.0 – Native API-Brücke (window.QfNativeApi).
 *
 * Übernimmt alles, was die Web-App sonst über das Netz machen würde:
 *  - POST/GET /api/logs      → postOperationLog / getOperationLogs (Datei im App-Speicher)
 *  - POST /api/analyze-dtc   → analyzeDtc (offline-Werkstatt-Hinweise, regelnbasiert)
 *  - Konfigs-Download        → saveAssetToDownloads (kopiert APK-Asset nach Downloads/,
 *                              ohne DownloadManager – der könnte die virtuelle
 *                              App-Domain nicht auflösen)
 *  - Diagnostik              → appInfo / console / copyToClipboard
 *
 * Alle Methoden sind bewusst synchron (JS-Seite wartet ohnehin) und werfen
 * NIEMALS – jede Exception wird als JSON-Error zurückgegeben, damit die
 * Oberfläche nie hängen bleibt.
 */
public final class QfNativeApi {

    private static final int MAX_LOGS = 500;
    private static final int MAX_CONSOLE_LINES = 250;

    private final Activity activity;
    private final Object logLock = new Object();
    private File logFile;
    private final AtomicLong idCounter = new AtomicLong();

    /** Ring-Puffer für JS-Console (für das native Fehlerbild statt weißem Screen). */
    private final ArrayDeque<String> consoleRing = new ArrayDeque<String>();

    /** Offline-Hinweise (identisch zum Server-Fallback der Website). */
    private static final Map<String, String> DTC_HINTS = new java.util.HashMap<String, String>();
    static {
        DTC_HINTS.put("00025", "Luftmassenmesser (HFM): Prüfen Sie Stecker/Korrosion. Typische Folge: Rauchentwicklung, Leistungsabfall, Notlaufprogramm.");
        DTC_HINTS.put("00064", "Laderdruckregelung: Laderschlauch auf Leckagen prüfen, Wastegate/Stellglied bewegen. Häufig Undichtigkeit oder verkoktes VTG.");
        DTC_HINTS.put("17964", "Ladedruck zu niedrig: Nebenluft bzw. geplatzte Laderschlauchleitung prüfen. Auch AGR-Undichtigkeit möglich.");
        DTC_HINTS.put("00087", "AGR-Ventil: AGR-Kühler/Ventil auf Verkokung prüfen, Stellglied ansteuern. Häufig bei hoher Laufleistung.");
        DTC_HINTS.put("00438", "Kurbelwellensensor: Kein Signal → Motor startet nicht. Sensorwechsel, Prüfen auf Metallspäne am Geber.");
        DTC_HINTS.put("01795", "Interne Steuergeräte-Störung: EEPROM/Programmspeicher defekt – Reparatur oder Tauschgerät nötig.");
    }

    public QfNativeApi(Activity activity) {
        this.activity = activity;
        this.logFile = new File(activity.getFilesDir(), "operation-log.json");
    }

    /* ---------------------------- Logs-API ---------------------------- */

    @JavascriptInterface
    public String postOperationLog(String json) {
        try {
            JSONObject in = new JSONObject(json);
            String operation = optStringMax(in, "operation", 64);
            if (operation.length() == 0) {
                return err(400, "operation fehlt");
            }
            String status = "ERROR".equals(in.optString("status")) ? "ERROR" : "OK";
            JSONObject entry = new JSONObject();
            entry.put("id", "native-" + System.currentTimeMillis() + "-" + idCounter.incrementAndGet());
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
                for (int i = 0; i < logs.length() && i < MAX_LOGS - 1; i++) {
                    next.put(logs.get(i));
                }
                saveLogsLocked(next);
            }
            JSONObject resp = new JSONObject();
            resp.put("id", entry.getString("id"));
            resp.put("ok", true);
            return resp.toString();
        } catch (Throwable t) {
            return err(400, "Ungültiger Log-Body: " + t.getMessage());
        }
    }

    @JavascriptInterface
    public String getOperationLogs(int limit) {
        try {
            if (limit < 1) limit = 50;
            if (limit > 200) limit = 200;
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
            return logsJson;
        } catch (Throwable t) {
            return err(500, "Logs konnten nicht gelesen werden");
        }
    }

    /* --------------------------- DTC-Analyse --------------------------- */

    @JavascriptInterface
    public String analyzeDtc(String json) {
        try {
            JSONObject in = new JSONObject(json);
            JSONArray dtcs = in.has("dtcs") && in.get("dtcs") instanceof JSONArray
                    ? in.getJSONArray("dtcs") : new JSONArray();
            if (dtcs.length() == 0) {
                return "{\"analysis\":\"Keine Fehlercodes vorhanden.\",\"source\":\"fallback\"}";
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
            return resp.toString();
        } catch (Throwable t) {
            return err(400, "Ungültiger Analyse-Body");
        }
    }

    /* --------------------------- Downloads ----------------------------- */

    /**
     * Kopiert ein APK-Asset (z. B. downloads/DeepOBD-Konfigs-M57-M47.zip) nach
     * Downloads/. Ab API 29 über MediaStore (echter Downloads-Ordner, ohne
     * Berechtigung), davor in den App-Downloads-Ordner (ohne Berechtigung).
     * Rückgabe: JSON {ok, path} oder {ok:false, error}.
     */
    @JavascriptInterface
    public String saveAssetToDownloads(String assetPath, String displayName) {
        try {
            String safeName = (displayName == null || displayName.trim().length() == 0)
                    ? "qflash21-download" : displayName.replaceAll("[^A-Za-z0-9._ \\-]", "_");
            byte[] data = readAssetFully("www/" + assetPath);
            if (data == null) {
                return err(404, "Asset nicht gefunden: " + assetPath);
            }
            String savedTo;
            if (Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues cv = new android.content.ContentValues();
                cv.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, safeName);
                cv.put(android.provider.MediaStore.Downloads.MIME_TYPE, mimeFor(safeName));
                Uri uri = activity.getContentResolver()
                        .insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) {
                    return err(500, "MediaStore-Eintrag fehlgeschlagen");
                }
                OutputStream os = activity.getContentResolver().openOutputStream(uri);
                if (os == null) {
                    return err(500, "OutputStream nicht verfügbar");
                }
                try {
                    os.write(data);
                    os.flush();
                } finally {
                    try { os.close(); } catch (Exception ignored) { }
                }
                savedTo = "Downloads/" + safeName;
            } else {
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = activity.getFilesDir();
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, safeName);
                FileOutputStream fos = new FileOutputStream(out);
                try {
                    fos.write(data);
                    fos.flush();
                } finally {
                    try { fos.close(); } catch (Exception ignored) { }
                }
                savedTo = out.getAbsolutePath();
            }
            toast("Gespeichert: " + safeName);
            JSONObject resp = new JSONObject();
            resp.put("ok", true);
            resp.put("path", savedTo);
            return resp.toString();
        } catch (Throwable t) {
            return err(500, "Download fehlgeschlagen: " + t.getMessage());
        }
    }

    /* --------------------------- Diagnostik ---------------------------- */

    /** Geräte-/App-Infos + letzte Konsolenzeilen – fürs Fehlerbild und den System-Check. */
    @JavascriptInterface
    public String appInfo() {
        try {
            JSONObject o = new JSONObject();
            o.put("version", "2.2.0");
            o.put("versionCode", 52);
            o.put("mode", "standalone-intercept");
            o.put("host", QfAssetInterceptor.APP_HOST);
            o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            o.put("android", Build.VERSION.RELEASE);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("startedAt", isoNow());
            JSONArray console = new JSONArray();
            synchronized (consoleRing) {
                for (String line : consoleRing) {
                    console.put(line);
                }
            }
            o.put("console", console);
            return o.toString();
        } catch (Throwable t) {
            return err(500, "appInfo fehlgeschlagen");
        }
    }

    /** JS-Console aus der WebView sammeln (WebChromeClient ruft das auf). */
    public void pushConsole(int level, String message, String sourceId, int lineNumber) {
        String tag = level == 3 ? "ERROR" : level == 2 ? "WARN" : "LOG";
        String shortSrc = sourceId == null ? "" : sourceId;
        int slash = shortSrc.lastIndexOf('/');
        if (slash >= 0) shortSrc = shortSrc.substring(slash + 1);
        String line = "[" + tag + "] " + message
                + (shortSrc.length() > 0 ? " (" + shortSrc + ":" + lineNumber + ")" : "");
        synchronized (consoleRing) {
            if (consoleRing.size() >= MAX_CONSOLE_LINES) {
                consoleRing.pollFirst();
            }
            consoleRing.addLast(line);
        }
    }

    @JavascriptInterface
    public String consoleTail() {
        StringBuilder sb = new StringBuilder();
        synchronized (consoleRing) {
            for (String line : consoleRing) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(line);
            }
        }
        return sb.toString();
    }

    /** Zuverlässiges Kopieren (auch im Fehlerbild, ohne Clipboard-API der Seite). */
    @JavascriptInterface
    public boolean copyToClipboard(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return false;
            cm.setPrimaryClip(ClipData.newPlainText("QFLASH21", text));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** kleines natives Feedback (z. B. nach Download). */
    public void toast(final String msg) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show();
                } catch (Throwable ignored) {
                    // egal
                }
            }
        });
    }

    /* ---------------------------- Speicher ----------------------------- */

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
            File tmp = new File(activity.getFilesDir(), "operation-log.json.tmp");
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
        Map<String, Integer> counts = new java.util.HashMap<String, Integer>();
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

    private static String err(int code, String msg) {
        try {
            return new JSONObject().put("error", msg).put("code", code).toString();
        } catch (Throwable t) {
            return "{\"error\":\"unbekannt\"}";
        }
    }

    private static String mimeFor(String name) {
        String p = name.toLowerCase(Locale.US);
        if (p.endsWith(".zip")) return "application/zip";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    private byte[] readAssetFully(String path) {
        try {
            InputStream in = activity.getAssets().open(path, android.content.res.AssetManager.ACCESS_STREAMING);
            try {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] tmp = new byte[16384];
                int n;
                while ((n = in.read(tmp)) > 0) {
                    buf.write(tmp, 0, n);
                }
                return buf.toByteArray();
            } finally {
                try { in.close(); } catch (Exception ignored) { }
            }
        } catch (Throwable t) {
            return null;
        }
    }

    private static String readFile(File f) throws java.io.IOException {
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
            } catch (java.io.IOException ignored) {
                // egal
            }
        }
    }

    private static void writeString(File f, String content) throws java.io.IOException {
        OutputStream out = new FileOutputStream(f);
        try {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } finally {
            try {
                out.close();
            } catch (java.io.IOException ignored) {
                // egal
            }
        }
    }
}
