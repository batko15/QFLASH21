#!/usr/bin/env bash
#
# QFLASH21 – STANDALONE APK Build (v2.2.0, hand-assembliert, ohne Gradle).
#
# Komplett eigenständige Android-App (Interceptor-Architektur):
#   - WebView + QfAssetInterceptor: die GESAMTE Web-App liegt in apk-src/assets/www/
#     und wird per WebViewClient.shouldInterceptRequest aus der APK bedient
#     (virtuelle Domain https://appassets.androidplatform.net). KEIN Socket,
#     KEIN Port, KEIN Cleartext, KEIN DNS – 100 % offline und immun gegen
#     die v2.1.0-White-Screen-Ursache (Loopback-Server von der WebView-
#     Netzwerkschicht nicht erreichbar).
#   - QfNativeApi (window.QfNativeApi): lokale APIs, Downloads, Diagnostik.
#   - SerialBridge: eigene USB-Serial-Treiberschicht (FTDI/CH340/CP2102) über
#     die Android USB-Host-API – BREAK-Signal für 5-Baud-Init inklusive.
#   KEINE externen Bibliotheken, KEIN browserhelper, KEIN Chrome/Net nötig.
#   Nur android.jar + eigener Code.
#
# Voraussetzungen:
#   - scripts/snapshot-site.sh AUSGEFÜHRT (assets/www/ muss gefüllt sein!)
#   - JDK (javac) oder Eclipse-Compiler (apk-src/libs/ecj.jar)
#   - Android build-tools 34 (aapt2, d8, zipalign, apksigner, dexdump) → env BT
#   - android.jar der Platform API 34                             → env AJ
#
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/../apk-src" && pwd)"
BUILD="$SRC_DIR/build-native"
LIBS="$SRC_DIR/libs"
BT="${BT:-/home/z/android-build/tools/android-14}"
AJ="${AJ:-/home/z/android-build/tools/android-34/android.jar}"
KS="${KS:-$SRC_DIR/qflash21-v12.keystore}"
KS_ALIAS="qflash21"
KS_PASS="${KS_PASS:-Qflash21-2026!Twa}"
OUT_APK="${OUT_APK:-QFLASH21-v2.3.0.apk}"

echo "==> 0/6 Standalone-Assets prüfen"
if [ ! -f "$SRC_DIR/assets/www/index.html" ]; then
  echo "FEHLER: apk-src/assets/www/index.html fehlt – erst scripts/snapshot-site.sh ausführen!" >&2
  exit 1
fi
ASSET_FILES="$(find "$SRC_DIR/assets/www" -type f | wc -l)"
if [ "$ASSET_FILES" -lt 10 ]; then
  echo "FEHLER: Nur $ASSET_FILES Asset-Dateien – Snapshot unvollständig!" >&2
  exit 1
fi
echo "    ✓ assets/www: $ASSET_FILES Dateien ($(du -sh "$SRC_DIR/assets/www" | cut -f1))"

echo "==> 1/6 Ressourcen kompilieren (aapt2)"
rm -rf "$BUILD"; mkdir -p "$BUILD/compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dexout"
"$BT/aapt2" compile --dir "$SRC_DIR/res" -o "$BUILD/compiled/res.zip"

echo "==> 2/6 Link (aapt2) → base.apk (inkl. Assets) + R.java"
"$BT/aapt2" link -o "$BUILD/base.apk" -I "$AJ" \
  --manifest "$SRC_DIR/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  -A "$SRC_DIR/assets" \
  "$BUILD/compiled/res.zip"

echo "==> 3/6 Java kompilieren (nur Framework – keine AARs nötig)"
find "$SRC_DIR/java" "$BUILD/gen" -name "*.java" > "$BUILD/sources.txt"
if command -v javac >/dev/null 2>&1; then
  javac --release 8 -nowarn -cp "$AJ" -d "$BUILD/classes" @"$BUILD/sources.txt"
else
  # Nur JRE vorhanden → Eclipse-Compiler
  java -jar "$LIBS/ecj.jar" -8 -nowarn -cp "$AJ" -d "$BUILD/classes" $(tr '\n' ' ' < "$BUILD/sources.txt")
fi
(cd "$BUILD/classes" && zip -qr "$BUILD/app-classes.jar" .)

echo "==> 4/6 DEX erzeugen (d8)"
"$BT/d8" --release --lib "$AJ" --min-api 24 --output "$BUILD/dexout" "$BUILD/app-classes.jar"
ls "$BUILD/dexout"

# SICHERHEITSKLEMME 1: Alle nativen Klassen müssen im DEX vorhanden sein
echo "==> 4b/6 DEX-Klassen-Verifikation"
for cls in 'de/qflash21/app/MainActivity' 'de/qflash21/app/SerialBridge' \
           'de/qflash21/app/QfAssetInterceptor' 'de/qflash21/app/QfNativeApi' \
           'de/qflash21/app/UsbSerialDriver' 'de/qflash21/app/FtdiDriver' \
           'de/qflash21/app/Ch340Driver' 'de/qflash21/app/Cp2102Driver' \
           'de/qflash21/app/QfApp' 'de/qflash21/app/CrashActivity'; do
  found=0
  for d in "$BUILD"/dexout/classes*.dex; do
    # kein 'grep -q' unter pipefail (SIGPIPE-Falle – siehe build-twa-apk.sh)
    if "$BT/dexdump" "$d" 2>/dev/null | grep "L$cls;" >/dev/null; then found=1; break; fi
  done
  if [ "$found" -ne 1 ]; then
    echo "BUILD ABGEBROCHEN: Klasse '$cls' fehlt im DEX!" >&2
    exit 1
  fi
  echo "    ✓ $cls"
done

echo "==> 5/6 APK packen + zipalign"
cp "$BUILD/base.apk" "$BUILD/packed.apk"
(cd "$BUILD/dexout" && for d in classes*.dex; do zip -q "$BUILD/packed.apk" "$d"; done)

# SICHERHEITSKLEMME 2: Eingebettete Web-App muss im APK sein
echo "==> 5b/6 Asset-Verifikation im APK"
unzip -l "$BUILD/packed.apk" | grep -E "assets/www/index\.html" >/dev/null || {
  echo "BUILD ABGEBROCHEN: assets/www/index.html fehlt im APK!" >&2; exit 1; }
APK_CHUNKS="$(unzip -l "$BUILD/packed.apk" | grep -c "assets/www/_next/static/" || true)"
if [ "${APK_CHUNKS:-0}" -lt 8 ]; then
  echo "BUILD ABGEBROCHEN: Nur $APK_CHUNKS _next-Dateien im APK (mind. 8 erwartet)!" >&2
  exit 1
fi
unzip -l "$BUILD/packed.apk" | grep -E "assets/www/downloads/DeepOBD" >/dev/null || {
  echo "BUILD ABGEBROCHEN: DeepOBD-Konfigs-ZIP fehlt im APK!" >&2; exit 1; }
echo "    ✓ assets/www/index.html + $APK_CHUNKS _next-Dateien + Konfigs-ZIP eingebettet"

"$BT/zipalign" -f 4 "$BUILD/packed.apk" "$BUILD/aligned.apk"

echo "==> 6/6 Signieren (apksigner)"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$BUILD/$OUT_APK" "$BUILD/aligned.apk"
"$BT/apksigner" verify --print-certs "$BUILD/$OUT_APK" | head -4

# Sanity: Package/Version/Launchable-Activity
"$BT/aapt" dump badging "$BUILD/$OUT_APK" 2>/dev/null | grep -E "^(package:|launchable-activity:|uses-permission:)"

cp "$BUILD/$OUT_APK" "$SRC_DIR/$OUT_APK"
echo "==> FERTIG: apk-src/$OUT_APK ($(du -h "$SRC_DIR/$OUT_APK" | cut -f1))"
