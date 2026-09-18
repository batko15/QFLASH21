# QFLASH21 Android-APK

## Downloads

| Datei | Zweck |
|---|---|
| `QFLASH21-v1.0.0-arm64.apk` | QFLASH21-Launcher (signiert, arm64 & alle anderen ABIs) |

> **Empfohlener Installationsweg** bleibt die **PWA-Installation** (Chrome → „App installieren“):
> Die installierte PWA läuft in Chrome selbst und unterstützt **Web Serial nativ** – genau wie der
> über den Launcher geöffnete Chrome. Der Launcher ist die bequeme Alternative mit eigenem Icon.

## Was macht die APK?

Ein minimaler, nativer **Launcher** (nur ~85 KB, keine Tracking-, keine Spezial-Berechtigungen):

1. Icon antippen → QFLASH21 öffnet sich **in Chrome** (`https://qflashk.vercel.app`)
2. Splash-Screen im QFLASH21-Design mit „APP ÖFFNEN“-Button (Fallback)
3. Ohne Chrome: öffnet einen beliebigen installierten Browser

**Bewusst kein WebView/TWA-Wrapper:** Web Serial (K-Line-Adapter per USB-OTG) funktioniert
zuverlässig **nur im echten Chrome** – WebView-Wrapper würden die Kernfunktion (Fahrzeug-Verbindung) brechen.

## Installation (Sideload)

1. APK auf das Handy kopieren (oder QR/Link)
2. Datei öffnen → „Aus unbekannten Quellen installieren“ erlauben
3. Icon „QFLASH21“ erscheint auf dem Homescreen → antippen → App öffnet in Chrome

Systemvoraussetzung: **Android 7.0+** (minSdk 24) · Signatur-SHA-256:
`8c9dfb2139127cd1866b80d95da861ad89c265222d8a67564beff5648bd68f06`

## Selbst bauen

Voraussetzungen: JDK 17+, Android SDK (build-tools 34, platform android-34)

```bash
bun scripts/make-apk-icons.mjs                          # Icons generieren
aapt2 compile --dir apk-src/res -o res.zip
aapt2 link -o base.apk -I $SDK/platforms/android-34/android.jar \
  --manifest apk-src/AndroidManifest.xml res.zip \
  --auto-add-overlay --min-sdk-version 24 --target-sdk-version 34
ecj -source 8 -target 8 -cp android.jar -d classes apk-src/java/**/*.java
d8 --release --lib android.jar --min-api 24 --output dexout classes/**/*.class
zip -j base.apk dexout/classes.dex && zipalign -f 4 base.apk aligned.apk
apksigner sign --ks <keystore> --out QFLASH21.apk aligned.apk
```

Oder automatisch per GitHub Actions: `.github/workflows/build-apk.yml`
(buildet bei jedem Push auf `apk-src/**` und hängt die APK als Artifact an).

## Quellcode

- `apk-src/AndroidManifest.xml` – Manifest (minSdk 24, target 34)
- `apk-src/java/de/qflash21/launcher/MainActivity.java` – Launcher-Logik (~150 Zeilen, kein WebView)
- `scripts/make-apk-icons.mjs` – Launcher-Icons aus dem App-Icon

Der Release-Signaturschlüssel (`qflash21.keystore`) wird **nicht** im Repo versioniert.
