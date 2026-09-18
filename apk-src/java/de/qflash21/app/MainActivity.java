package de.qflash21.app;

import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * QFLASH21 – Trusted Web Activity (TWA).
 *
 * Rendert https://qflashk.vercel.app fullscreen in Chrome (AndroidX Browser Helper).
 * Chrome-Rendering ist Pflicht: Web Serial (K-Line/KWP2000-Adapter per USB-OTG)
 * funktioniert nur im echten Chrome – ein WebView wäre für die Fahrzeugdiagnose unbrauchbar.
 *
 * Ist die Domain über https://qflashk.vercel.app/.well-known/assetlinks.json verifiziert,
 * läuft die App ohne URL-Balken wie eine native App.
 *
 * v1.3.1 (kritischer Fix): Package muss exakt {@code de.qflash21.app} sein –
 * in v1.3.0 lag die Klasse noch im alten Package {@code de.qflash21.launcher},
 * während das Manifest bereits {@code de.qflash21.app.MainActivity} erwartete.
 * Ergebnis war ClassNotFoundException → „App startet und schließt sofort".
 *
 * Zusätzlich: Exceptions in onCreate werden abgefangen und landen im
 * CrashActivity-Fehlerbericht (statt stumm zu verschwinden).
 */
public class MainActivity extends LauncherActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable t) {
            CrashActivity.show(this, t);
            finish();
        }
    }
}
