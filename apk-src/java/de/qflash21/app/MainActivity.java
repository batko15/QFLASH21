package de.qflash21.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * QFLASH21 v2.2.0 – STANDALONE (komplett eigenständige Android-App).
 *
 * Architektur v2.2.0 (ersetzt den Loopback-HTTP-Server von v2.1.0):
 *  - WebViewClient.shouldInterceptRequest bedient ALLE Requests der virtuellen
 *    Domain https://appassets.androidplatform.net/ direkt aus der APK
 *    (assets/www/) – offizielles WebViewAssetLoader-Muster, aber ohne AndroidX.
 *    KEIN Socket, KEIN Port, KEIN Cleartext, KEIN DNS, KEINE VPN-/Firewall-
 *    Interferenz mehr → die v2.1.0-White-Screen-Ursache ist eliminiert.
 *  - window.QfNativeApi (QfNativeApi): lokale APIs (Operationshistorie,
 *    DTC-Analyse), Downloads nach Downloads/, Diagnostik.
 *  - window.QfSerialBridge (SerialBridge): Android USB-Host-API für das
 *    K+DCAN-Kabel (FTDI/CH340/CP2102) per USB-OTG.
 *  - NIE WIEDER WEIẞ: onReceivedError/onReceivedHttpError → native deutsche
 *    Fehlerseite mit Diagnose + „Erneut versuchen". Render-Watchdog fängt
 *    leere Seiten ab. onRenderProcessGone baut die WebView neu auf.
 */
public class MainActivity extends Activity {

    private static final long RENDER_WATCHDOG_MS = 6000L;

    private ViewGroup rootLayout;
    private WebView webView;
    private SerialBridge bridge;
    private QfNativeApi nativeApi;
    private QfAssetInterceptor interceptor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean showingNativeError = false;
    private boolean crashed = false;

    private final Runnable renderWatchdog = new Runnable() {
        @Override
        public void run() {
            checkRenderedOrShowError();
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

        rootLayout = new ViewGroup(this) {
            @Override
            protected void onLayout(boolean changed, int l, int t, int r, int b) {
                for (int i = 0; i < getChildCount(); i++) {
                    getChildAt(i).layout(l, t, r, b);
                }
            }
        };
        webView = createWebView();
        rootLayout.addView(webView);
        setContentView(rootLayout);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
            // Sicherheitsnetz: falls der wiederhergestellte Zustand leer/defekt ist,
            // lädt der Watchdog neu (Sichtprüfung nach RENDER_WATCHDOG_MS).
            mainHandler.postDelayed(renderWatchdog, RENDER_WATCHDOG_MS);
        } else {
            webView.loadUrl(QfAssetInterceptor.START_URL);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView createWebView() {
        WebView wv = new WebView(this);
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

        // Fern-Diagnose möglich halten (chrome://inspect) – hilft bei Geräteproblemen
        try {
            WebView.setWebContentsDebuggingEnabled(true);
        } catch (Throwable ignored) {
            // ältere WebViews
        }

        wv.addJavascriptInterface(nativeApi, "QfNativeApi");
        wv.addJavascriptInterface(bridge, "QfSerialBridge");

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                try {
                    nativeApi.pushConsole(m.messageLevel() != null ? levelInt(m.messageLevel()) : 1,
                            m.message(), m.sourceId(), m.lineNumber());
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
                    // Notfall: Asset-Auslieferung darf nie ins Leere laufen
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
                if (interceptor.isAppUrl(url)) {
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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (interceptor.isAppUrl(Uri.parse(url)) && !showingNativeError) {
                    mainHandler.removeCallbacks(renderWatchdog);
                    mainHandler.postDelayed(renderWatchdog, RENDER_WATCHDOG_MS);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    String desc = "";
                    int code = -1;
                    try {
                        CharSequence d = error.getDescription();
                        desc = d != null ? d.toString() : "";
                        code = error.getErrorCode();
                    } catch (Throwable ignored) {
                        // egal
                    }
                    showNativeErrorPage("Netzwerkfehler beim Laden (" + code + ")",
                            desc + "\nURL: " + request.getUrl());
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                if (request != null && request.isForMainFrame() && errorResponse != null) {
                    showNativeErrorPage("HTTP-Fehler " + errorResponse.getStatusCode(),
                            "URL: " + request.getUrl());
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // WebView-Renderer gestorben (bekannte White-Screen-/Crash-Ursache auf
                // einigen ROMs) → WebView NEU AUFBauen statt Absturz/weißer Fläche.
                if (view == webView) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            rebuildWebView();
                        }
                    });
                    return true;
                }
                return false;
            }
        });

        return wv;
    }

    private static int levelInt(ConsoleMessage.MessageLevel level) {
        if (level == ConsoleMessage.MessageLevel.ERROR) return 3;
        if (level == ConsoleMessage.MessageLevel.WARNING) return 2;
        return 1;
    }

    private void rebuildWebView() {
        try {
            rootLayout.removeAllViews();
            if (webView != null) {
                try {
                    webView.destroy();
                } catch (Throwable ignored) {
                    // egal
                }
            }
            webView = createWebView();
            rootLayout.addView(webView);
            webView.loadUrl(QfAssetInterceptor.START_URL);
        } catch (Throwable t) {
            CrashActivity.show(MainActivity.this, "WebView konnte nicht neu gestartet werden", t);
            finish();
        }
    }

    /* ------------------- RENDER-WATCHDOG (nie wieder weiß) ------------------- */

    private void checkRenderedOrShowError() {
        if (webView == null || showingNativeError) {
            return;
        }
        try {
            webView.evaluateJavascript(
                    "(function(){try{return String(document.body?document.body.innerText.length:0)}"
                            + "catch(e){return '-1'}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            int len = -1;
                            try {
                                len = Integer.parseInt(value == null ? "" : value.replace("\"", ""));
                            } catch (Throwable ignored) {
                                // egal
                            }
                            if (len < 40) {
                                showNativeErrorPage(
                                        "Oberfläche hat nicht geladen",
                                        "Die App-Oberfläche blieb leer (Rendering-Check: "
                                                + len + " Zeichen).");
                            }
                        }
                    });
        } catch (Throwable t) {
            showNativeErrorPage("Oberflächen-Prüfung fehlgeschlagen", String.valueOf(t));
        }
    }

    /* ---------------------- NATIVE FEHLERSEITE (statt weiß) ---------------------- */

    private void showNativeErrorPage(final String title, final String details) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (showingNativeError || webView == null) {
                    return;
                }
                showingNativeError = true;
                mainHandler.removeCallbacks(renderWatchdog);
                try {
                    webView.loadDataWithBaseURL(QfAssetInterceptor.START_URL, buildErrorHtml(title, details),
                            "text/html", "utf-8", null);
                } catch (Throwable t) {
                    // Selbst das Fehlerbild scheitert → native Fallback-UI im Layout
                    showNativeFallbackView(title, details);
                }
            }
        });
    }

    private String buildErrorHtml(String title, String details) {
        String console = safe(() -> nativeApi.consoleTail());
        String diag = safe(() -> {
            StringBuilder sb = new StringBuilder();
            sb.append("QFLASH21 v2.2.0 (versionCode 52) – Standalone\n");
            sb.append("Fehler: ").append(title).append('\n');
            sb.append("Details: ").append(details).append('\n');
            sb.append("Gerät: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
            sb.append("Android: ").append(Build.VERSION.RELEASE)
              .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
            sb.append("Architektur: shouldInterceptRequest (kein Socket-Server)\n");
            sb.append("\n-- Konsolenprotokoll (letzte Zeilen) --\n").append(console);
            return sb.toString();
        });
        String escTitle = escape(title);
        String escDetails = escape(details).replace("\n", "<br>");
        String escDiag = escape(diag);
        return "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>"
                + "body{font-family:sans-serif;background:#09090b;color:#fafafa;margin:0;"
                + "display:flex;align-items:center;justify-content:center;min-height:100vh}"
                + ".card{max-width:32rem;width:92%;padding:1.5rem;border:1px solid #27272a;"
                + "border-radius:12px;background:#111113}"
                + "h1{font-size:1.25rem;margin:0 0 .5rem}"
                + "p{color:#a1a1aa;font-size:.9rem;line-height:1.5;margin:.4rem 0}"
                + "pre{background:#09090b;border:1px solid #27272a;border-radius:8px;padding:.75rem;"
                + "font-size:.72rem;color:#d4d4d8;max-height:9rem;overflow:auto;white-space:pre-wrap}"
                + "button{cursor:pointer;border:0;border-radius:8px;padding:.7rem 1rem;font-size:.9rem;"
                + "font-weight:600;margin-right:.5rem;margin-top:.75rem}"
                + ".retry{background:#f59e0b;color:#18181b;display:inline-block;text-decoration:none}"
                + ".copy{background:#27272a;color:#fafafa}"
                + "</style></head><body><div class=\"card\">"
                + "<h1>⚠ " + escTitle + "</h1>"
                + "<p>" + escDetails + "</p>"
                + "<p>Die App ist als Standalone-App installiert (kein Internet nötig). "
                + "Falls dieser Fehler wiederholt auftritt, bitte den Diagnosetext kopieren "
                + "und an den Entwickler senden.</p>"
                + "<pre id=\"diag\">" + escDiag + "</pre>"
                + "<a class=\"retry\" href=\"" + QfAssetInterceptor.START_URL + "\">ERNEUT VERSUCHEN</a>"
                + "<button class=\"copy\" onclick=\"try{QfNativeApi.copyToClipboard("
                + "document.getElementById('diag').innerText)}catch(e){}\">Diagnose kopieren</button>"
                + "</div></body></html>";
    }

    /** Letzte Rettung, wenn sogar loadDataWithBaseURL scheitert: natives Layout. */
    private void showNativeFallbackView(String title, String details) {
        try {
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setBackgroundColor(Color.parseColor("#09090b"));
            box.setPadding(48, 48, 48, 48);
            box.setGravity(android.view.Gravity.CENTER);
            TextView tv = new TextView(this);
            tv.setTextColor(Color.WHITE);
            tv.setTextSize(16);
            tv.setText("QFLASH21\n\n" + title + "\n\n" + details);
            Button retry = new Button(this);
            retry.setText("ERNEUT VERSUCHEN");
            retry.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showingNativeError = false;
                    rootLayout.removeAllViews();
                    rootLayout.addView(webView);
                    webView.loadUrl(QfAssetInterceptor.START_URL);
                }
            });
            box.addView(tv);
            box.addView(retry);
            setContentView(box);
        } catch (Throwable t) {
            CrashActivity.show(this, title, t);
            finish();
        }
    }

    private static String safe(java.util.concurrent.Callable<String> c) {
        try {
            return c.call();
        } catch (Throwable t) {
            return "(Diagnose nicht verfügbar)";
        }
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
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
            if (webView != null) {
                webView.loadUrl(QfAssetInterceptor.START_URL);
                return;
            }
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
