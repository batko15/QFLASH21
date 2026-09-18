package de.qflash21.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * QFLASH21 v2.0 – ECHTE native Android-App.
 *
 * Architektur:
 *  - Native Activity mit WebView (lädt die QFLASH21-Weboberfläche)
 *  - SerialBridge (addJavascriptInterface): stellt die Android USB-Host-API
 *    als "window.QfSerialBridge" bereit – FTDI/CH340/CP2102 DIREKT vom
 *    Android-Kernel-Weg, ohne Chrome, ohne Web Serial, ohne TWA-Verifikation.
 *  - Damit funktioniert das K+DCAN-Kabel auf JEDEM Android-Gerät ab 7.0,
 *    unabhängig von installierter Chrome-Version.
 *
 * v1.3.x war eine Trusted Web Activity (TWA) – abhängig von Chrome/Custom-Tabs
 * und Domain-Verifikation. Das erwies sich auf dem Zielsystem als fehleranfällig.
 */
public class MainActivity extends Activity {

    static final String START_URL = "https://qflashk.vercel.app/?app=native";
    private static final String ALLOWED_HOST = "qflashk.vercel.app";

    private WebView webView;
    private SerialBridge bridge;
    private boolean crashed = false;

    @SuppressLint("SetJavaScriptEnabled")
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

    @SuppressLint("SetJavaScriptEnabled")
    private void setup(Bundle savedInstanceState) {
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Nur QFLASH21 in der App – alles andere (z. B. GitHub) extern im Browser
                if (url != null && url.contains(ALLOWED_HOST)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Throwable ignored) {
                    // Kein Browser vorhanden – URL ignorieren
                }
                return true;
            }
        });

        bridge = new SerialBridge(this);
        webView.addJavascriptInterface(bridge, "QfSerialBridge");

        setContentView(webView);
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** USB-Abzug: Bridge schließen + Weboberfläche informieren (Toast + Disconnect). */
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
            // Selte ROMs – Diagnose läuft trotzdem (ohne Auto-Detect)
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
