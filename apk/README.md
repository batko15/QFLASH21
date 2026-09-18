# QFLASH21 Android-APK (v1.2.0 – TWA)

## Downloads

| Datei | Zweck |
|---|---|
| `QFLASH21-v1.2.0.apk` | **Empfohlen**: Trusted Web Activity (fullscreen in Chrome, kein URL-Balken) |
| Web-Direktlink | `https://qflashk.vercel.app/apk/QFLASH21-v1.2.0.apk` |

> Die App rendert die Seite über **Chrome** (Trusted Web Activity) – nur dort ist
> **Web Serial** (K-Line-Adapter per USB-OTG) verfügbar. Bei verifizierter Domain
> (`/.well-known/assetlinks.json`) läuft die App **fullscreen ohne Browserleiste**.

## Was macht die APK?

Echte Android-App (TWA, AndroidX Browser Helper) – kein WebView:

1. Icon antippen → Splash → QFLASH21 als fullscreen App (Chrome-Engine)
2. Domain-Verifizierung via `assetlinks.json` → kein URL-Balken
3. Fallback ohne TWA-Provider: Custom Tab / beliebiger Browser (mit Browserleiste)
4. ~2,6 MB, keine Tracking-Berechtigungen (nur INTERNET + ACCESS_NETWORK_STATE)

## Installation (Sideload)

1. **Alte QFLASH21-Version deinstallieren** (v1.2.0 hat eine neue Signatur!)
2. APK öffnen (Download von der Website oder aus dem GitHub-Repo)
3. „Aus dieser Quelle installieren“ erlauben
4. **MagicOS (Honor/Huawei):** ggf. „Reiner Modus“ (Pure Mode) deaktivieren – blockiert Sideloads
5. Play-Protect-Hinweis mit „Trotzdem installieren“ bestätigen
6. **Chrome muss installiert sein** (Web Serial!) – ohne Chrome fällt die App in einen Browser-Fallback ohne Diagnose-Fähigkeit

Systemvoraussetzung: **Android 7.0+** (minSdk 24, targetSdk 34)

Signatur-SHA-256 (v1.2.0):
`6C:62:FD:BC:A4:83:57:15:77:A3:98:16:23:F0:EB:03:70:7A:A3:CA:41:28:2B:54:F7:5E:F1:18:96:31:CA:7E`

## Domain-Verifizierung (assetlinks.json)

`public/.well-known/assetlinks.json` enthält die App-Signatur und wird von Vercel ausgeliefert:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "de.qflash21.launcher",
    "sha256_cert_fingerprints": ["6C:62:…:7E"]
  }
}]
```

Prüf-URL: `https://qflashk.vercel.app/.well-known/assetlinks.json`

## Selbst bauen

Voraussetzungen: JDK 17+ (java, keytool), Android build-tools 34 (aapt2, d8, zipalign,
apksigner), android.jar (API 34), Bibliotheken unter `apk-src/libs/` (AARs entpackt).

```bash
# Bibliotheken (Google Maven) – bereits unter apk-src/libs/ enthalten:
#   androidbrowserhelper 2.5.0 · androidx.browser 1.8.0 · androidx.core 1.13.1
#   annotation-jvm 1.8.1 · collection-jvm 1.4.4 · concurrent-futures 1.1.0*
#   lifecycle-common-jvm/lifecycle-runtime-android 2.8.7 · interpolator 1.0.0
#   versionedparcelable 1.1.1 · annotation-experimental 1.4.1 · kotlin-stdlib 1.8.22
#   guava-listenablefuture 1.0 · ecj 3.33.0
#   (*) 1.2.0 ist ein Multi-Release-JAR und bringt d8 8.2 zum Absturz → 1.1.0 verwenden!

BT=/pfad/zu/build-tools-34  AJ=/pfad/zu/android-34/android.jar \
  KS_PASS='DeinKeystorePasswort' bash scripts/build-twa-apk.sh
```

Der Build (aapt2 → ecj/javac → d8 → zipalign → apksigner) erzeugt
`apk-src/QFLASH21-v1.2.0.apk` + Keystore `apk-src/qflash21-v12.keystore` (Alias `qflash21`,
Passwort nur lokal – **nicht im Repo**, siehe Chat-/lokale Notiz).

## Quellcode

- `apk-src/AndroidManifest.xml` – TWA-Manifest (meta-data DEFAULT_URL, Farben, FALLBACK_STRATEGY)
- `apk-src/java/de/qflash21/launcher/MainActivity.java` – erweitert `LauncherActivity` (Browser Helper)
- `apk-src/libs/` – AndroidX-/Helper-Bibliotheken (AAR + JAR, siehe oben)
- `scripts/build-twa-apk.sh` – kompletter Build ohne Gradle
- `scripts/make-apk-icons.mjs` – Launcher-Icons aus dem App-Icon
