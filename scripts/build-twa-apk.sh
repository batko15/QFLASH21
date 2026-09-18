#!/usr/bin/env bash
#
# QFLASH21 – TWA-APK Build (v1.2.0, hand-assembliert, ohne Gradle/Android-Studio).
#
# Erzeugt eine signierte Trusted-Web-Activity-APK (androidx.browser + browserhelper),
# die https://qflashk.vercel.app fullscreen in Chrome rendert (Web Serial verfügbar).
#
# Voraussetzungen:
#   - JDK 17+ (javac, keytool)
#   - Android build-tools 34 (aapt2, d8, zipalign, apksigner)   → env BT
#   - android.jar der Platform API 34                            → env AJ
#   - Bibliotheken unter apk-src/libs/ (AARs entpackt + JARs, siehe apk/README.md)
#
# Umgebungsvariablen:
#   BT        build-tools-Verzeichnis
#   AJ        Pfad zu android.jar
#   KS_PASS   Keystore-Passwort (Default siehe unten; Nur für lokalen Build!)
#
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/../apk-src" && pwd)"
BUILD="$SRC_DIR/build"
LIBS="$SRC_DIR/libs"
BT="${BT:-/home/z/android-build/tools/android-14}"
AJ="${AJ:-/home/z/android-build/tools/android-34/android.jar}"
KS="${KS:-$SRC_DIR/qflash21-v12.keystore}"
KS_ALIAS="qflash21"
KS_PASS="${KS_PASS:-Qflash21-2026!Twa}"
OUT_APK="${OUT_APK:-QFLASH21-v1.3.0.apk}"

# AARs entpacken (classes.jar/res), falls noch nicht geschehen
ensure_lib() {
  if [ ! -d "$LIBS/$1" ] && [ -f "$LIBS/$2" ]; then
    mkdir -p "$LIBS/$1"
    (cd "$LIBS/$1" && unzip -qo "../$2")
  fi
}
ensure_lib aabh aabh.aar
ensure_lib browser browser.aar
ensure_lib core core.aar
ensure_lib vp vp.aar
ensure_lib lrt lrt.aar
ensure_lib interp interp.aar
ensure_lib annexp annexp.jar

echo "==> 1/7 Ressourcen kompilieren (aapt2)"
rm -rf "$BUILD"; mkdir -p "$BUILD/compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dexout"
flatzips=()
add_res() { # $1 = res-Verzeichnis
  [ -d "$1" ] || return 0
  local name; name="$(echo "$1" | md5sum | cut -c1-8)"
  "$BT/aapt2" compile --dir "$1" -o "$BUILD/compiled/$name.zip"
  flatzips+=("$BUILD/compiled/$name.zip")
}
add_res "$SRC_DIR/res"
add_res "$LIBS/aabh/res"
add_res "$LIBS/browser/res"
add_res "$LIBS/core/res"
add_res "$LIBS/lrt/res"
add_res "$LIBS/annexp/res"

echo "==> 2/7 Link (aapt2) → base.apk + R.java"
"$BT/aapt2" link -o "$BUILD/base.apk" -I "$AJ" \
  --manifest "$SRC_DIR/AndroidManifest.xml" \
  --java "$BUILD/gen" --auto-add-overlay \
  --min-sdk-version 24 --target-sdk-version 34 \
  "${flatzips[@]}"

echo "==> 3/7 Java kompilieren (javac, release 8)"
libjars=()
for j in "$LIBS"/*.jar; do [ -f "$j" ] && libjars+=("$j"); done
for j in "$LIBS"/*/classes.jar; do [ -f "$j" ] && libjars+=("$j"); done
CP="$(IFS=:; echo "${libjars[*]}")"
find "$SRC_DIR/java" "$BUILD/gen" -name "*.java" > "$BUILD/sources.txt"
if command -v javac >/dev/null 2>&1; then
  javac --release 8 -nowarn -cp "$AJ:$CP" -d "$BUILD/classes" @"$BUILD/sources.txt"
else
  # Nur JRE vorhanden → Eclipse-Compiler (apk-src/libs/ecj.jar)
  java -jar "$LIBS/ecj.jar" -8 -nowarn -cp "$AJ:$CP" -d "$BUILD/classes" $(tr '\n' ' ' < "$BUILD/sources.txt")
fi
(cd "$BUILD/classes" && zip -qr "$BUILD/app-classes.jar" .)

echo "==> 4/7 DEX erzeugen (d8, multidex-fähig)"
d8inputs=("$BUILD/app-classes.jar" "${libjars[@]}")
"$BT/d8" --release --lib "$AJ" --min-api 24 --output "$BUILD/dexout" "${d8inputs[@]}"
ls "$BUILD/dexout"

echo "==> 5/7 APK packen"
cp "$BUILD/base.apk" "$BUILD/packed.apk"
(cd "$BUILD/dexout" && for d in classes*.dex; do zip -q "$BUILD/packed.apk" "$d"; done)

echo "==> 6/7 zipalign"
"$BT/zipalign" -f 4 "$BUILD/packed.apk" "$BUILD/aligned.apk"

echo "==> 7/7 Signieren (apksigner)"
if [ ! -f "$KS" ]; then
  echo "    Keystore fehlt – erzeuge $KS"
  keytool -genkeypair -v -keystore "$KS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=QFLASH21 TWA, OU=Development, O=batko15, L=Gelibolu, ST=Canakkale, C=TR"
fi
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$BUILD/$OUT_APK" "$BUILD/aligned.apk"
"$BT/apksigner" verify --print-certs "$BUILD/$OUT_APK" | head -8

cp "$BUILD/$OUT_APK" "$SRC_DIR/$OUT_APK"
echo "==> FERTIG: apk-src/$OUT_APK ($(du -h "$SRC_DIR/$OUT_APK" | cut -f1))"
echo "    SHA-256 (für assetlinks.json):"
keytool -list -v -keystore "$KS" -alias "$KS_ALIAS" -storepass "$KS_PASS" 2>/dev/null \
  | grep "SHA256:" | head -1
