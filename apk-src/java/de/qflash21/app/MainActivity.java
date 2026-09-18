package de.qflash21.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;

/**
 * QFLASH21 v2.1.0 – STANDALONE (komplett eigenständige Android-App).
 *
 * Architektur:
 *  - QfAssetServer serviert die KOMPLETT in die APK eingebettete Web-App
 *    (assets/www/ – inkl. aller Chunks, Bilder und DeepOBD-Konfigs) über
 *    http://127.0.0.1:&lt;Port&gt; an die WebView. Kein Internet, keine Website,
 *    kein Chrome nötig – die App funktioniert im Flugmodus.
 *  - SerialBridge (addJavascriptInterface "QfSerialBridge"): Android USB-Host-
 *    API als window.QfSerialBridge – FTDI/CH340/CP2102 NATIV für das
 *    K+DCAN-Kabel per USB-OTG.
 *  - /api/logs + /api/analyze-dtc werden lokal im QfAssetServer bedient
 *    (Operationshistorie im App-Speicher, offline-Werkstatt-Hinweise).
 *  - Downloads (z. B. DeepOBD-Konfigs-ZIP) laufen über den System-DownloadManager
 *    – der kann 127.0.0.1 der App erreichen und speichert nach Downloads/.
 *
 * Historie: v1.x war eine TWA (abhängig von Chrome + Domain-Verifikation),
 * v2.0.0 lud die Website aus dem Internet. v2.1.0 braucht GAR NICHTS mehr –
 * alles ist an Bord.
 */
public class MainActivity extends Activity {

    private WebView webView;
    private SerialBridge bridge;
    private QfAssetServer assetServer;
    private boolean crashed = false;

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
    private void setup(Bundle savedInstanceState) throws IOException {
        // 1) Lokaler Server für die eingebettete Web-App (fester Port → localStorage bleibt erhalten)
        assetServer = new QfAssetServer(this);
        int port = assetServer.start();
        String startUrl = "http://127.0.0.1:" + port + "/";

        // 2) WebView
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
                // Nur die lokale App-Oberfläche im WebView – alles andere extern im Browser
                if (url != null && url.startsWith("http://127.0.0.1:")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Throwable ignored) {
                    // Kein Browser vorhanden – URL ignorieren
                }
                return true;
            }
        });

        // 3) Downloads (DeepOBD-Konfigs-ZIP etc.) über den System-DownloadManager
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                try {
                    String name = Uri.parse(url).getLastPathSegment();
                    if (name == null || name.length() == 0) name = "qflash21-download";
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    r.setTitle(name);
                    r.setDescription("QFLASH21 Standalone");
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(r);
                        Toast.makeText(MainActivity.this, "Download gestartet: " + name,
                                Toast.LENGTH_SHORT).show();
                    }
                } catch (Throwable t) {
                    Toast.makeText(MainActivity.this, "Download nicht möglich: " + t.getMessage(),
                            Toast.LENGTH_LONG).show();
                }
            }
        });

        // 4) Native USB-Serial-Bridge für das K+DCAN-Kabel
        bridge = new SerialBridge(this);
        webView.addJavascriptInterface(bridge, "QfSerialBridge");

        setContentView(webView);
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(startUrl);
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
        if (assetServer != null) assetServer.stop();
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
