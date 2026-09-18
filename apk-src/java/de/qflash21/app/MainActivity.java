package de.qflash21.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * QFLASH21 v2.3.0 – STANDALONE mit NATIVER SELBSTDIGNOSE + REPARATURLEITER.
 *
 * BEFUND aus v2.2.0 (Screenshot des Nutzers: komplett weiß, weder SSR-Inhalt
 * noch Fehlerseite sichtbar): Die WebView selbst rendert auf dem Gerät gar
 * nichts – Seiteninhalte sind laut Desktop-Test in Ordnung. Ursachen können
 * sein: defekte/beschädigte System-WebView, HW-Composer-Problem des ROMs
 * (MagicOS), Renderer-Prozess tot, oder Interception/Ladephase hängt.
 *
 * GEGENMASSNAHMEN v2.3.0:
 *  1. NATIVE STATUSLEISTE (außerhalb der WebView, immer sichtbar bis zur
 *     Bestätigung des Renderns): App-Version, WebView-Version, Ladephase,
 *     letzter Fehler/JS-Konsolenfehler. Der nächste Screenshot des Nutzers
 *     zeigt DAMIT sofort die Ursache – kein Blindflug mehr.
 *  2. REPARATURLEITER bei leerem/hängendem Render:
 *     Versuch 1: Neuladen (ohne Cache)
 *     Versuch 2: WebView-NEUAUFBAU mit SOFTWARE-Rendering (LAYER_TYPE_SOFTWARE)
 *                – behebt HW-Composer-Probleme alter/besonderer ROMs
 *     Versuch 3: Direkter Datei-Modus file:///android_asset/www/index.html
 *                (komplett unabhängig von Interception/DNS/Netzwerkschicht;
 *                 index.html nutzt dafür relative Pfade)
 *     Versuch 4: Nativer Fehlerbericht (reines Android-Layout, ohne WebView)
 *                 mit „Bericht kopieren“ + „App neu starten“
 *  3. FrameLayout als Root (statt Custom-ViewGroup ohne onMeasure –
 *     möglicher Layout-/Render-Risikofaktor in v2.2.0).
 *  4. Watchdogs: renderWatchdog (6 s nach onPageFinished) UND hardWatchdog
 *     (14 s nach loadUrl) – greift auch, wenn das Laden ohne onPageFinished
 *     hängt.
 */
public class MainActivity extends Activity {

    private static final long RENDER_WATCHDOG_MS = 6000L;
    private static final long HARD_WATCHDOG_MS = 14000L;
    private static final String FILE_URL = "file:///android_asset/www/index.html";
    private static final Pattern CHROME_UA = Pattern.compile("Chrome/([0-9]+)");

    private FrameLayout rootLayout;
    private LinearLayout statusBar;
    private TextView statusTitle;
    private TextView statusDetail;
    private WebView webView;
    private SerialBridge bridge;
    private QfNativeApi nativeApi;
    private QfAssetInterceptor interceptor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean showingNativeError = false;
    private boolean renderConfirmed = false;
    private boolean crashed = false;
    private int recoveryAttempt = 0;
    private int currentLayerType = View.LAYER_TYPE_HARDWARE;
    private String currentUrl = QfAssetInterceptor.START_URL;

    private final Runnable renderWatchdog = new Runnable() {
        @Override
        public void run() {
            checkRenderedOrRecover();
        }
    };

    private final Runnable hardWatchdog = new Runnable() {
        @Override
        public void run() {
            if (!renderConfirmed && !showingNativeError) {
                beginRecovery("Laden hängt (kein Seitenende)");
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable t) {
            crashed = true;
            CrashActivity.show(this, "QFLASH21-Start fehlgeschlagen", t);
            finish();
            return;
        }
        try {
            setup(savedInstanceState);
        } catch (Throwable t) {
            CrashActivity.show(this, "QFLASH21-Oberfläche konnte nicht geladen werden", t);
            finish();
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setup(Bundle savedInstanceState) {
        interceptor = new QfAssetInterceptor(getAssets());
        nativeApi = new QfNativeApi(this);
        bridge = new SerialBridge(this);

        // FrameLayout (Standard!): korrektes onMeasure/onLayout für die WebView
        rootLayout = new FrameLayout(this);
        webView = createWebView();
        rootLayout.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        statusBar = buildStatusBar();
        rootLayout.addView(statusBar, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(rootLayout);

        showWebViewVersionAsync();

        if (savedInstanceState != null) {
            try {
                webView.restoreState(savedInstanceState);
            } catch (Throwable ignored) {
                // leerer Zustand → Watchdog/Reparaturleiter greift
            }
            armWatchdogs();
        } else {
            loadCurrent();
        }
    }

    /* --------------------------- WebView-Setup --------------------------- */

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView createWebView() {
        WebView wv = new WebView(this);
        try {
            wv.setLayerType(currentLayerType, null);
        } catch (Throwable ignored) {
            // Layer-Type nicht verfügbar
        }
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setAllowFileAccess(true);
        // Für den Notfall-Pfad file:///android_asset/www/:
        try {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        } catch (Throwable ignored) {
            // ältere WebViews
        }

        try {
            WebView.setWebContentsDebuggingEnabled(true);
        } catch (Throwable ignored) {
            // ältere WebViews
        }

        try {
            wv.addJavascriptInterface(nativeApi, "QfNativeApi");
            wv.addJavascriptInterface(bridge, "QfSerialBridge");
        } catch (Throwable ignored) {
            // Interface-Fehler dürfen die Oberfläche nicht blockieren
        }

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                try {
                    int lvl = m.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? 3
                            : m.messageLevel() == ConsoleMessage.MessageLevel.WARNING ? 2 : 1;
                    nativeApi.pushConsole(lvl, m.message(), m.sourceId(), m.lineNumber());
                    // JS-Fehler VOR bestätigtem Rendern direkt in die Statusleiste:
                    if (lvl >= 2 && !renderConfirmed) {
                        phase("JS: " + abbreviate(m.message(), 110));
                    }
                } catch (Throwable ignored) {
                    // Diagnose darf niemals stören
                }
                return true;
            }
        });

        wv.setWebViewClient(new WebViewClient() {

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                try {
                    if (interceptor.isAppUrl(request.getUrl())) {
                        return interceptor.intercept(request);
                    }
                } catch (Throwable t) {
                    try {
                        byte[] msg = ("QFLASH21 Interceptor-Fehler: " + t)
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        return new WebResourceResponse("text/plain; charset=utf-8", "utf-8", 500, "Error",
                                null, new java.io.ByteArrayInputStream(msg));
                    } catch (Throwable ignored) {
                        // egal
                    }
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String u = url != null ? url.toString() : "";
                if (interceptor.isAppUrl(url) || u.startsWith("file:///android_asset/www/")) {
                    return false; // im WebView laden
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Throwable ignored) {
                    // Kein Browser vorhanden – URL ignorieren
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (!renderConfirmed) {
                    phase("Lade: " + abbreviate(url, 60));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!renderConfirmed && (interceptor.isAppUrl(Uri.parse(url))
                        || url.startsWith("file:///android_asset/www/"))) {
                    phase("Seite empfangen – prüfe Rendering…");
                    mainHandler.removeCallbacks(renderWatchdog);
                    mainHandler.postDelayed(renderWatchdog, 1200L);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request != null && request.isForMainFrame() && !renderConfirmed) {
                    String desc = "";
                    int code = -1;
                    try {
                        CharSequence d = error.getDescription();
                        desc = d != null ? d.toString() : "";
                        code = error.getErrorCode();
                    } catch (Throwable ignored) {
                        // egal
                    }
                    beginRecovery("Fehler " + code + ": " + desc);
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                if (request != null && request.isForMainFrame() && !renderConfirmed
                        && errorResponse != null) {
                    beginRecovery("HTTP-Fehler " + errorResponse.getStatusCode());
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Renderer tot (bekannte White-Screen-Ursache) → sofort Neuaufbau
                if (view == webView) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            beginRecovery("WebView-Renderer beendet");
                        }
                    });
                    return true;
                }
                return false;
            }
        });

        return wv;
    }

    /* ----------------------- Laden + Reparaturleiter ----------------------- */

    private void loadCurrent() {
        renderConfirmed = false;
        phase("Lade Oberfläche" + (recoveryAttempt > 0
                ? " (Reparaturversuch " + recoveryAttempt + "/3)" : "") + "…");
        armWatchdogs();
        try {
            webView.loadUrl(currentUrl);
        } catch (Throwable t) {
            beginRecovery("loadUrl fehlgeschlagen: " + t.getMessage());
        }
    }

    private void armWatchdogs() {
        mainHandler.removeCallbacks(renderWatchdog);
        mainHandler.removeCallbacks(hardWatchdog);
        mainHandler.postDelayed(renderWatchdog, RENDER_WATCHDOG_MS);
        mainHandler.postDelayed(hardWatchdog, HARD_WATCHDOG_MS);
    }

    private void checkRenderedOrRecover() {
        if (webView == null || showingNativeError || renderConfirmed) {
            return;
        }
        try {
            webView.evaluateJavascript(
                    "(function(){try{var t=(document.body&&document.body.innerText)"
                            + "?document.body.innerText.length:0;"
                            + "var ok=document.title&&document.title.indexOf('QFLASH21')>=0;"
                            + "return String(t+'|'+(ok?'1':'0'));}catch(e){return '-1|0'}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            try {
                                String v = value == null ? "" : value.replace("\"", "");
                                int bar = v.indexOf('|');
                                int len = bar > 0 ? Integer.parseInt(v.substring(0, bar)) : -1;
                                boolean titleOk = v.endsWith("|1");
                                if (len >= 40 && titleOk) {
                                    confirmRender(len);
                                } else if (recoveryAttempt < 3) {
                                    beginRecovery("Oberfläche leer (Zeichen: " + len + ")");
                                } else {
                                    showNativeErrorView("Oberfläche blieb leer",
                                            "Rendering-Check: " + len + " Zeichen · Titel ok: "
                                                    + titleOk);
                                }
                            } catch (Throwable t) {
                                beginRecovery("Prüfung fehlgeschlagen: " + t.getMessage());
                            }
                        }
                    });
        } catch (Throwable t) {
            beginRecovery("evaluateJavascript fehlgeschlagen: " + t.getMessage());
        }
    }

    private void confirmRender(int chars) {
        renderConfirmed = true;
        mainHandler.removeCallbacks(renderWatchdog);
        mainHandler.removeCallbacks(hardWatchdog);
        phase("Oberfläche aktiv ✓ (" + chars + " Zeichen"
                + (recoveryAttempt > 0 ? " · Reparaturversuch " + recoveryAttempt : "") + ")");
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (statusBar != null) {
                    statusBar.setVisibility(View.GONE);
                }
            }
        }, 2500L);
    }

    /** REPARATURLEITER: 1 Reload → 2 Software-Rendering → 3 file://-Modus → 4 Fehlerbericht. */
    private void beginRecovery(final String reason) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (showingNativeError || renderConfirmed) {
                    return;
                }
                nativeApi.pushConsole(2, "RECOVERY: " + reason, "native", 0);
                recoveryAttempt++;
                switch (recoveryAttempt) {
                    case 1:
                        phase("⚠ " + abbreviate(reason, 60) + " → Neuladen (1/3)…");
                        try {
                            webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
                        } catch (Throwable ignored) {
                            // egal
                        }
                        mainHandler.removeCallbacks(hardWatchdog);
                        mainHandler.postDelayed(hardWatchdog, 10000L);
                        try {
                            webView.loadUrl(currentUrl);
                        } catch (Throwable t) {
                            beginRecovery("Neuladen fehlgeschlagen");
                        }
                        break;
                    case 2:
                        phase("⚠ Reparatur 2/3: Software-Rendering…");
                        rebuildWebView(View.LAYER_TYPE_SOFTWARE, QfAssetInterceptor.START_URL);
                        break;
                    case 3:
                        phase("⚠ Reparatur 3/3: Direkter Datei-Modus…");
                        rebuildWebView(currentLayerType, FILE_URL);
                        break;
                    default:
                        showNativeErrorView("Oberfläche konnte nicht geladen werden", reason);
                        break;
                }
            }
        });
    }

    private void rebuildWebView(int layerType, String url) {
        try {
            currentLayerType = layerType;
            currentUrl = url;
            // Root-Layout wieder als Content-View setzen (nötig nach dem nativen
            // Fehlerbericht, der setContentView(box) benutzt hat)
            setContentView(rootLayout);
            rootLayout.removeAllViews();
            if (webView != null) {
                try {
                    webView.destroy();
                } catch (Throwable ignored) {
                    // egal
                }
            }
            webView = createWebView();
            rootLayout.addView(webView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            rootLayout.addView(statusBar, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            statusBar.setVisibility(View.VISIBLE);
            loadCurrent();
        } catch (Throwable t) {
            showNativeErrorView("WebView-Neuaufbau fehlgeschlagen", String.valueOf(t));
        }
    }

    /* ------------------------ NATIVE STATUSLEISTE ------------------------ */

    private LinearLayout buildStatusBar() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(10), dp(6), dp(10), dp(6));
        box.setBackgroundColor(Color.parseColor("#09090b"));

        statusTitle = new TextView(this);
        statusTitle.setTextColor(Color.parseColor("#fafafa"));
        statusTitle.setTextSize(11);
        statusTitle.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        statusTitle.setText("QFLASH21 v2.3.0 · Standalone · WebView: …");
        statusTitle.setSingleLine(true);
        statusTitle.setEllipsize(TextUtils.TruncateAt.END);

        statusDetail = new TextView(this);
        statusDetail.setTextColor(Color.parseColor("#fbbf24"));
        statusDetail.setTextSize(11);
        statusDetail.setTypeface(Typeface.MONOSPACE);
        statusDetail.setText("Start…");
        statusDetail.setMaxLines(3);
        statusDetail.setEllipsize(TextUtils.TruncateAt.END);

        box.addView(statusTitle);
        box.addView(statusDetail);
        return box;
    }

    /** WebView-Version ermitteln (kann blockieren → Hintergrund-Thread). */
    private void showWebViewVersionAsync() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String shortUa = "unbekannt";
                try {
                    String ua = WebSettings.getDefaultUserAgent(getApplicationContext());
                    Matcher m = CHROME_UA.matcher(ua);
                    if (m.find()) {
                        shortUa = "Chromium " + m.group(1);
                    } else {
                        shortUa = abbreviate(ua, 40);
                    }
                } catch (Throwable ignored) {
                    // WebView-Problem → genau DAS wird damit sichtbar
                }
                final String finalUa = shortUa;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (statusTitle != null) {
                            statusTitle.setText("QFLASH21 v2.3.0 · Standalone · WebView: " + finalUa);
                        }
                    }
                });
            }
        }, "QfUaProbe").start();
    }

    private void phase(final String msg) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (statusDetail != null) {
                    statusDetail.setText(msg);
                    statusBar.setVisibility(View.VISIBLE);
                }
            }
        });
    }

    /* ------------------- NATIVER FEHLERBERICHT (letzte Stufe) ------------------- */

    private void showNativeErrorView(final String title, final String details) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (showingNativeError) {
                    return;
                }
                showingNativeError = true;
                mainHandler.removeCallbacks(renderWatchdog);
                mainHandler.removeCallbacks(hardWatchdog);
                try {
                    StringBuilder diag = new StringBuilder();
                    diag.append("QFLASH21 v2.3.0 (versionCode 53) – Standalone\n");
                    diag.append("Fehler: ").append(title).append('\n');
                    diag.append("Details: ").append(details).append('\n');
                    diag.append("Reparaturversuche: ").append(recoveryAttempt).append("/3\n");
                    diag.append("Lademodus: ").append(currentUrl).append('\n');
                    diag.append("Rendering-Layer: ")
                        .append(currentLayerType == View.LAYER_TYPE_SOFTWARE ? "SOFTWARE" : "HARDWARE")
                        .append('\n');
                    diag.append("Gerät: ").append(Build.MANUFACTURER).append(' ')
                        .append(Build.MODEL).append('\n');
                    diag.append("Android: ").append(Build.VERSION.RELEASE)
                        .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
                    try {
                        diag.append("WebView-UA: ").append(
                                WebSettings.getDefaultUserAgent(getApplicationContext())).append('\n');
                    } catch (Throwable ignored) {
                        diag.append("WebView-UA: NICHT ERMITTELBAR (WebView defekt?)\n");
                    }
                    diag.append("\n-- Protokoll (Konsolen-/App-Zeilen) --\n");
                    try {
                        diag.append(nativeApi.consoleTail());
                    } catch (Throwable ignored) {
                        // egal
                    }

                    LinearLayout box = new LinearLayout(MainActivity.this);
                    box.setOrientation(LinearLayout.VERTICAL);
                    box.setBackgroundColor(Color.parseColor("#09090b"));
                    box.setPadding(dp(20), dp(20), dp(20), dp(20));
                    box.setGravity(Gravity.CENTER);

                    TextView tv = new TextView(MainActivity.this);
                    tv.setTextColor(Color.WHITE);
                    tv.setTextSize(15);
                    tv.setTypeface(Typeface.MONOSPACE);
                    tv.setText("⚠ QFLASH21\n\n" + title + "\n\n"
                            + "Die App hat 3 Reparaturversuche unternommen "
                            + "(Neuladen, Software-Rendering, Datei-Modus).\n\n"
                            + "Bitte „Bericht kopieren“ antippen und den Bericht "
                            + "an den Entwickler senden.");
                    ScrollViewish scroll = new ScrollViewish(MainActivity.this);
                    TextView report = new TextView(MainActivity.this);
                    report.setTextColor(Color.parseColor("#a1a1aa"));
                    report.setTextSize(9);
                    report.setTypeface(Typeface.MONOSPACE);
                    report.setText(diag.toString());
                    scroll.addView(report);
                    scroll.setLayoutParams(new LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

                    Button copy = new Button(MainActivity.this);
                    copy.setText("Bericht kopieren");
                    final String reportText = diag.toString();
                    copy.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            nativeApi.copyToClipboard(reportText);
                            nativeApi.toast("Bericht kopiert – hier einfügen im Chat");
                        }
                    });
                    Button restart = new Button(MainActivity.this);
                    restart.setText("App neu starten");
                    restart.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            showingNativeError = false;
                            recoveryAttempt = 0;
                            currentLayerType = View.LAYER_TYPE_HARDWARE;
                            currentUrl = QfAssetInterceptor.START_URL;
                            rebuildWebView(currentLayerType, currentUrl);
                        }
                    });

                    LinearLayout buttons = new LinearLayout(MainActivity.this);
                    buttons.setOrientation(LinearLayout.HORIZONTAL);
                    buttons.setGravity(Gravity.CENTER);
                    buttons.addView(copy);
                    buttons.addView(restart);

                    box.addView(tv);
                    box.addView(scroll);
                    box.addView(buttons);
                    setContentView(box);
                } catch (Throwable t) {
                    CrashActivity.show(MainActivity.this, title, t);
                    finish();
                }
            }
        });
    }

    /** Minimal-ScrollView (klasse statt generisch, um Import-Salat zu vermeiden). */
    private static final class ScrollViewish extends android.widget.ScrollView {
        ScrollViewish(Context c) {
            super(c);
        }
    }

    private static int dp(int v) {
        return Math.round(v * android.content.res.Resources.getSystem().getDisplayMetrics().density);
    }

    private static String abbreviate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    /* ------------------------------ Lifecycle ------------------------------ */

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (showingNativeError) {
            showingNativeError = false;
            recoveryAttempt = 0;
            currentLayerType = View.LAYER_TYPE_HARDWARE;
            currentUrl = QfAssetInterceptor.START_URL;
            rebuildWebView(currentLayerType, currentUrl);
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** USB-Abzug: Bridge schließen + Weboberfläche informieren. */
    private final BroadcastReceiver detachReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            UsbDevice d = null;
            try {
                d = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            } catch (Throwable ignored) {
                // ältere Gerätevarianten
            }
            if (bridge != null) {
                bridge.onDeviceDetached(d != null ? d.getVendorId() : -1, d != null ? d.getProductId() : -1);
            }
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('qf-usb-detach'));", null);
            }
        }
    };

    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter f = new IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(detachReceiver, f, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(detachReceiver, f);
            }
        } catch (Throwable ignored) {
            // seltene ROMs – Diagnose läuft trotzdem (ohne Auto-Detect)
        }
    }

    @Override
    protected void onStop() {
        try {
            unregisterReceiver(detachReceiver);
        } catch (Throwable ignored) {
            // war nicht registriert
        }
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        if (bridge != null) bridge.shutdown();
        if (webView != null) {
            try {
                webView.destroy();
            } catch (Throwable ignored) {
                // egal
            }
        }
        if (crashed) return;
        super.onDestroy();
    }
}
