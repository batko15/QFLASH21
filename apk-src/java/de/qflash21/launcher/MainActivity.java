package de.qflash21.launcher;

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
 * Ohne TWA-Provider (z. B. ohne Chrome) öffnet die App als Custom Tab / im Standard-Browser
 * (FALLBACK_STRATEGY=customtabs im Manifest).
 */
public class MainActivity extends LauncherActivity {
}
