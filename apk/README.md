# QFLASH21 Android-APK

## v2.2.0 – STANDALONE Interceptor (empfohlen: komplett eigenständig, 100 % offline, FIX für „weiße App")

| Datei | Zweck |
|---|---|
| `QFLASH21-v2.2.0.apk` | **Empfohlen**: Komplette App mit EINGEBETTETER Website (~9 MB) – funktioniert im Flugmodus |
| Web-Direktlink | `https://qflashk.vercel.app/apk/QFLASH21-v2.2.0.apk` |
| GitHub Release | `https://github.com/batko15/QFLASH21/releases/tag/v2.2.0` |

### Architektur v2.2.0 (versionCode 52, ~9 MB, Android 7.0+)

```
MainActivity (WebView → https://appassets.androidplatform.net/)
  ├─ QfAssetInterceptor (WebViewClient.shouldInterceptRequest)
  │    ├─ assets/www/index.html + _next/static/immutable/** (gesamte Web-App)
  │    ├─ assets/www/downloads/DeepOBD-Konfigs-M57-M47.zip (nativ via MediaStore nach Downloads/)
  │    ├─ /api/*  → bewusst 501 (APIs laufen über window.QfNativeApi, da
  │    │             shouldInterceptRequest den POST-Body nicht bereitstellt)
  │    └─ /sw.js  → bewusst 404 (kein Service Worker nötig – alles ist lokal)
  ├─ QfNativeApi  (addJavascriptInterface → window.QfNativeApi)
  │    ├─ postOperationLog/getOperationLogs → Operationshistorie LOKAL (filesDir/operation-log.json, max. 500)
  │    ├─ analyzeDtc → offline-Werkstatt-Hinweise (Regeltabelle = Server-Fallback)
  │    ├─ saveAssetToDownloads → APK-Asset nativ nach Downloads/ (MediaStore ab API 29)
  │    ├─ appInfo/consoleTail/copyToClipboard → Diagnostik
  │    └─ (WebChromeClient.onConsoleMessage sammelt JS-Konsole fürs Fehlerbild)
  ├─ SerialBridge  (addJavascriptInterface → window.QfSerialBridge)
  │    ├─ FtdiDriver    SIO-Requests 1:1 aus ftdi_sio.c  (Reset/Purge/Baud/SET_DATA/Latency/DTR-RTS)
  │    ├─ Ch340Driver   ch341.c-Register (0x5F/0xA1/0x9A·0x1312/0x2518/0xA4, BREAK 0x1805)
  │    └─ Cp2102Driver  cp210x.c-Requests (0x1E Baud u32-LE, 0x03 LINE_CTL, 0x07 MHS, 0x16 BREAK)
  │         └─ Android USB-Host-API (UsbManager → bulkTransfer) → K+DCAN per USB-OTG
  └─ NIE WIEDER WEIẞ (4 Verteidigungslinien):
       1. onReceivedError/onReceivedHttpError (Main-Frame) → deutsche Fehlerseite
          mit Diagnose + Konsolenprotokoll + „Diagnose kopieren" + „ERNEUT VERSUCHEN"
       2. Render-Watchdog (6 s): leere Oberfläche → Fehlerseite statt weiß
       3. onRenderProcessGone → WebView wird NEU AUFGEBAUT (bekannte White-Screen-Ursache)
       4. QfApp + CrashActivity: globaler Crash-Handler mit deutschem Bericht
```

**WARUM v2.2.0? (Root-Cause-Fix für „Die Applikation bleibt einfach weiß")**

v2.1.0 servierte die Oberfläche über einen eigenen HTTP-Server auf `127.0.0.1:21921`.
Auf dem Gerät des Nutzers blieb die WebView dadurch WEIß – der Chromium-Netzwerk-Stack
erreichte den Loopback-Server nicht (bekanntes Problem: Google Issue Tracker „Android
WebView Blocking Cleartext HTTP Traffic to localhost", chromium.org #40933016 „Blank
screen in apps with webview"; Auslöser auf ROMs: Cleartext-Restriktionen, VPN-/AdBlocker-
Interferenz auf Loopback, OEM-Anpassungen wie MagicOS).

v2.2.0 entfernt die Netzwerkschicht KOMPLETT – nach dem offiziellen
**WebViewAssetLoader-Muster** (developer.android.com, androidx.webkit):
`shouldInterceptRequest` fängt ALLE Requests der virtuellen Domain
`https://appassets.androidplatform.net/` ab und bedient sie direkt aus dem
AssetManager. **Kein Socket, kein Port, kein Cleartext, kein DNS, keine VPN-Interferenz
mehr** – strukturell immun gegen die gesamte v2.1.0-Ausfallklasse.

- **Secure Context** durch https-Schema (Clipboard, crypto, localStorage) – ohne Server.
- Web-App erkennt die Brücken automatisch: `window.QfSerialBridge` (USB) +
  `window.QfNativeApi` (lokale APIs/Downloads, `src/lib/kwp/native-api.ts`);
  Website-Code bleibt unverändert lauffähig (fetch-Fallbacks).
- USB-Treiberschicht unverändert nativ (FTDI/CH340/CP2102, 5-Baud-Init über BREAK,
  RX-Pump mit 64-KB-Ringpuffer + Status-Byte-Stripping, USB-Detach-Event).
- Gleiche Paket-ID `de.qflash21.app` + Signatur `6c62fd…` wie v1.3.x/v2.0.0/v2.1.0 →
  sauberes Upgrade ohne Deinstallation.

**Build (2 Schritte):**

```bash
bash scripts/snapshot-site.sh     # 1) Produktionssite → apk-src/assets/www/ (11 MB, 18 Dateien)
bash scripts/build-native-apk.sh  # 2) aapt2(-A assets) → javac/ecj → d8 → DEX-Checks →
                                  #    Asset-Checks → zipalign → apksigner  →  QFLASH21-v2.2.0.apk
```

Build-Sicherheitsklemmen: 10 Klassen im DEX (inkl. `QfAssetInterceptor` + `QfNativeApi`,
ohne das entfernte `QfAssetServer`), `assets/www/index.html` + ≥ 8 `_next`-Dateien +
Konfigs-ZIP im APK – sonst Abbruch.

### Installation v2.2.0

1. APK herunterladen und öffnen (Dateimanager → Downloads). Upgrade über
   v2.1.0/v2.0.0/v1.3.x direkt möglich (gleiche Signatur).
2. MagicOS (Honor): ggf. „Reiner Modus" (Pure Mode) deaktivieren – blockiert Sideloads.
3. Play-Protect-Hinweis mit „Trotzdem installieren" bestätigen.
4. App öffnen → lädt SOFORT offline (Flugmodus egal) → Tab „Verbindung" → „Verbinden"
   → K+DCAN per USB-OTG → beim ersten Mal USB-Berechtigung bestätigen.
5. Tab „System-Check" zeigt **„Bereit für K+DCAN per USB-OTG"** (grün) + APK-Karte v2.2.0.
6. DeepOBD-Konfigs: Tab „DDE4-Konfigs" → Download kopiert nativ nach `Downloads/`.

**Falls doch einmal etwas nicht lädt:** Die App zeigt dann KEIN weißes Bild, sondern
eine deutsche Fehlerseite mit Ursache + Konsolenprotokoll → „Diagnose kopieren" →
Bericht hier in den Chat.

---

## v2.1.0 – STANDALONE Loopback-Server (Legacy – Weiß-Screen-Risiko, durch v2.2.0 ersetzt)

**STATUS: Legacy. Auf dem Gerät des Nutzers blieb die App weiß (Loopback-Server von
der WebView-Netzwerkschicht nicht erreichbar). Durch v2.2.0 (Interceptor) ersetzt.**

| Datei | Zweck |
|---|---|
| `QFLASH21-v2.1.0.apk` | Legacy: komplette App eingebettet, aber Loopback-HTTP-Server (127.0.0.1:21921) – auf manchen Geräten weiß |

### Architektur v2.1.0 (versionCode 51, ~9 MB)

```
MainActivity (WebView → http://127.0.0.1:21921)
  ├─ QfAssetServer (Thread-per-Connection, nur 127.0.0.1, Pfad-Traversal-Schutz)
  └─ SerialBridge (identisch zu v2.2.0)
```

---

## v2.0.0 – NATIVE APP (Legacy: lädt die Website aus dem Internet)

| Datei | Zweck |
|---|---|
| `QFLASH21-v2.0.0.apk` | Legacy: Native USB-Treiber, aber Oberfläche kam von qflashk.vercel.app (99 KB) |

### Architektur v2.0.0 (versionCode 50, ~100 KB, Android 7.0+)

```
MainActivity (WebView → qflashk.vercel.app)
  └─ SerialBridge  (addJavascriptInterface → window.QfSerialBridge)
       ├─ FtdiDriver    SIO-Requests 1:1 aus ftdi_sio.c  (Reset/Purge/Baud/SET_DATA/Latency/DTR-RTS)
       ├─ Ch340Driver   ch341.c-Register (0x5F/0xA1/0x9A·0x1312/0x2518/0xA4, BREAK 0x1805)
       └─ Cp2102Driver  cp210x.c-Requests (0x1E Baud u32-LE, 0x03 LINE_CTL, 0x07 MHS, 0x16 BREAK)
            └─ Android USB-Host-API (UsbManager → bulkTransfer) → K+DCAN per USB-OTG
```

- **Kein Chrome, kein Web Serial, kein Custom Tabs, keine assetlinks-Verifikation** –
  die App spricht das Kabel direkt über die Android USB-Host-API an.
- Weboberfläche (gleiche App-UI) erkennt `window.QfSerialBridge` und bevorzugt die
  native Bridge vor Web Serial/WebUSB (`src/lib/kwp/native-bridge.ts`).
- 5-Baud-Init nativ über BREAK; RX-Pump-Thread mit Ringpuffer (64 KB, FTDI/CH340-
  Status-Byte-Stripping); USB-Detach-Event an die Seite (`qf-usb-detach`).
- USB-Berechtigung per Systemdialog (Broadcast-Latch, 20 s Timeout).
- Gleiche Paket-ID `de.qflash21.app` + Signatur `6c62fd…` wie v1.3.x → sauberes Upgrade.
- Build: `scripts/build-native-apk.sh` (aapt2 → ecj/javac → d8 → DEX-Klassen-Verifikation
  → zipalign → apksigner). Quellcode: `apk-src/java/de/qflash21/app/` (8 Klassen,
  reine Framework-APIs – KEINE externen Bibliotheken).

### Installation v2.0.0

1. APK herunterladen und öffnen (Dateimanager → Downloads). Upgrade über v1.3.x direkt möglich.
2. MagicOS (Honor): ggf. „Reiner Modus" (Pure Mode) deaktivieren – blockiert Sideloads.
3. Play-Protect-Hinweis mit „Trotzdem installieren" bestätigen.
4. K+DCAN-Kabel per USB-OTG anschließen → App öffnet → Tab „Verbindung" → „Verbinden"
   → beim ersten Mal USB-Berechtigung bestätigen.
5. Tab „System-Check" zeigt **„Bereit – Native-App-Modus (USB-Host-API)"** (grün).

---

## Legacy: TWA-Versionen v1.0–v1.3.1

## Warum v1.3.1? (Fehler-Chronik)

| Version | Paket-ID | Signatur | Problem |
|---|---|---|---|
| v1.0–v1.1 | `de.qflash21.launcher` | Cert A (`a2d639…`, Passwort verloren) | Nur Browser-Shortcut, kein TWA |
| v1.2.0 | `de.qflash21.launcher` | Cert B (`6c62fd…`) | Konflikt mit installierter v1.0/v1.1 → **„App wurde nicht installiert“** |
| v1.3.0 | `de.qflash21.app` | Cert B (`6c62fd…`) | Installiert sauber, **ABSTURZ beim Start**: `MainActivity` lag noch im DEX unter `de.qflash21.launcher`, Manifest erwartete `de.qflash21.app.MainActivity` → `ClassNotFoundException` → **„startet und schließt sofort“** |
| **v1.3.1** | **`de.qflash21.app`** | Cert B (`6c62fd…`) | **Start-Crash behoben** (Klasse im richtigen Package, DEX-Verifikation im Build) + nativer Fehlerbericht + WebView-Fallback; Upgrade über installierte v1.3.0 ohne Deinstallation (gleiche Signatur, versionCode 41 > 40) |

Alte QFLASH21-Apps (v1.0–v1.2, Paket-ID `de.qflash21.launcher`) nach erfolgreicher
Installation von v1.3.1 deinstallieren. v1.3.1 selbst aktualisiert v1.3.0 automatisch.

## Was macht die APK?

Echte Android-App (TWA, AndroidX Browser Helper) – kein WebView als Hauptpfad:

1. Icon antippen → Splash → QFLASH21 als fullscreen App (Chrome-Engine)
2. Domain-Verifizierung via `assetlinks.json` → kein URL-Balken
3. **Fehlerbericht statt Absturz:** Globaler Uncaught-Exception-Handler (`QfApp`)
   zeigt bei JEDEM Fehler einen nativen deutschen Bericht (CrashActivity) mit
   Stacktrace, Geräteinfo und den Buttons „Fehler kopieren“ / „In Chrome öffnen“ /
   „App neu starten“ – die App verschwindet nie stumm.
4. **WebView-Fallback** (`FALLBACK_STRATEGY=webview`): Ohne Chrome oder ohne
   Domain-Verifizierung öffnet die Seite im eingebetteten WebView statt zu schließen
   (Web Serial funktioniert dort nicht – die Web-App zeigt dann einen Hinweis).
5. **1,5 MB** (v1.3.0: 2,6 MB – versehentlich eingebetteter Eclipse-Compiler entfernt),
   keine Tracking-Berechtigungen (nur INTERNET + ACCESS_NETWORK_STATE)
6. **Neu (Web-App): Tab „System-Check“** – prüft Web Serial, Chrome-Version,
   WebUSB-Fallback, HTTPS, App-Modus + kopierbarer Diagnose-Bericht

## WebUSB-Fallback (Web-App)

Android-Chrome unterstützt **USB**-Serial nativ erst ab **Chrome 148** (davor nur
Bluetooth-RFCOMM ab 138). Die Web-App enthält deshalb einen vollwertigen
**WebUSB-Fallback** (`src/lib/kwp/webusb-serial.ts`) mit Treibern für
**FTDI FT232/FT231X, CH340/CH341 und CP2102** (Baudraten-/BREAK-Register 1:1 aus dem
Linux-Kernel: `ftdi_sio.c`, `ch341.c`, `cp210x.c`) – inklusive 5-Baud-Init über
BREAK-Signal. Damit läuft das K+DCAN-Kabel auf **jedem** Android-Chrome (ab 61)
per USB-C-OTG – auch in der TWA.

## Installation (Sideload)

1. v1.3.1 direkt über eine installierte v1.3.0 drüber-installieren (gleiche Signatur) –
   oder bei Problemen alle alten QFLASH21-Apps deinstallieren
2. APK öffnen (Download von der Website, aus dem Repo oder GitHub-Release)
3. „Aus dieser Quelle installieren“ erlauben
4. **MagicOS (Honor/Huawei):** ggf. „Reiner Modus“ (Pure Mode) deaktivieren – blockiert Sideloads
5. Play-Protect-Hinweis mit „Trotzdem installieren“ bestätigen
6. **Chrome muss installiert sein** (Web Serial!) – ohne Chrome öffnet der WebView-Fallback
   die Seite ohne Diagnose-Fähigkeit
7. App öffnen → Tab **„System-Check“** muss grün zeigen
8. **Falls die App doch je schließen sollte:** Beim nächsten Start erscheint der
   Fehlerbericht (oder sofort) – „Fehler kopieren“ und Bericht in den Chat einfügen

Systemvoraussetzung: **Android 7.0+** (minSdk 24, targetSdk 34)

Signatur-SHA-256 (v1.3.1, `de.qflash21.app` – identisch zu v1.3.0, daher Upgrades möglich):
`6C:62:FD:BC:A4:83:57:15:77:A3:98:16:23:F0:EB:03:70:7A:A3:CA:41:28:2B:54:F7:5E:F1:18:96:31:CA:7E`

## Domain-Verifizierung (assetlinks.json)

`public/.well-known/assetlinks.json` enthält **beide** Paket-IDs (v1.3.0 + Legacy) und
wird von Vercel ausgeliefert:

```json
[
  { "target": { "package_name": "de.qflash21.app",      "sha256_cert_fingerprints": ["6C:62:…:7E"] } },
  { "target": { "package_name": "de.qflash21.launcher", "sha256_cert_fingerprints": ["6C:62:…:7E"] } }
]
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

Der Build (aapt2 → ecj/javac → d8 → DEX-Klassen-Verifikation → zipalign → apksigner)
erzeugt `apk-src/QFLASH21-v1.3.1.apk` + Keystore `apk-src/qflash21-v12.keystore`
(Alias `qflash21`, Passwort nur lokal – **nicht im Repo**, siehe Chat-/lokale Notiz).
Version/Paket-ID: `apk-src/AndroidManifest.xml` (`versionCode 41`, `versionName 1.3.1`,
`package de.qflash21.app`).

> **Build-Sicherheitsklemme:** Nach d8 prüft das Skript, dass `MainActivity`, `QfApp`,
> `CrashActivity` und `LauncherActivity` wirklich im DEX liegen – exakt der Fehler,
> der v1.3.0 zum sofortigen Schließen brachte, kann nie wieder unbemerkt durchgehen.
> (Achtung: keine `grep -q`-Pipes unter `set -o pipefail` – SIGPIPE-Falle.)

## Quellcode

- `apk-src/AndroidManifest.xml` – TWA-Manifest (meta-data DEFAULT_URL, Farben, FALLBACK_STRATEGY=webview)
- `apk-src/java/de/qflash21/app/MainActivity.java` – erweitert `LauncherActivity` (Browser Helper)
- `apk-src/java/de/qflash21/app/QfApp.java` – Application mit globalem Crash-Handler
- `apk-src/java/de/qflash21/app/CrashActivity.java` – nativer deutscher Fehlerbericht (ohne androidx!)
- `apk-src/libs/` – AndroidX-/Helper-Bibliotheken (AAR + JAR, siehe oben)
- `scripts/build-twa-apk.sh` – kompletter Build ohne Gradle
- `scripts/make-apk-icons.mjs` – Launcher-Icons aus dem App-Icon
