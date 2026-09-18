#!/usr/bin/env bash
#
# QFLASH21 – NATIVE APK Build (v2.0.0, hand-assembliert, ohne Gradle).
#
# Echte Android-App: WebView + native USB-Serial-Bridge (FTDI/CH340/CP2102)
# über die Android USB-Host-API – KEINE externen Bibliotheken, KEIN browserhelper,
# KEINE TWA-Abhängigkeiten. Nur android.jar + eigener Code.
#
# Voraussetzungen:
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
OUT_APK="${OUT_APK:-QFLASH21-v2.0.0.apk}"

echo "==> 1/6 Ressourcen kompilieren (aapt2)"
rm -rf "$BUILD"; mkdir -p "$BUILD/compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dexout"
"$BT/aapt2" compile --dir "$SRC_DIR/res" -o "$BUILD/compiled/res.zip"

echo "==> 2/6 Link (aapt2) → base.apk + R.java"
"$BT/aapt2" link -o "$BUILD/base.apk" -I "$AJ" \
  --manifest "$SRC_DIR/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
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

# SICHERHEITSKLEMME: Alle nativen Klassen müssen im DEX vorhanden sein
echo "==> 4b/6 DEX-Klassen-Verifikation"
for cls in 'de/qflash21/app/MainActivity' 'de/qflash21/app/SerialBridge' \
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
