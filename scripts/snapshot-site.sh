#!/usr/bin/env bash
#
# QFLASH21 v2.2.0 STANDALONE – spiegelt die komplette Produktions-Website
# in die APK-Assets (apk-src/assets/www), damit die Android-App 100 % offline
# mit eingebetteter Oberfläche läuft (kein Internet, kein Chrome, keine Website).
# v2.2.0: App lädt per shouldInterceptRequest (Interceptor-Architektur).
#
# Schritte:
#   1. index.html von der Produktion laden
#   2. Alle /_next/static/-Referenzen per Fixpunkt-Analyse herunterladen
#      (HTML → JS/CSS → weitere Chunks, bis nichts Neues gefunden wird)
#   3. Bekannte Public-Dateien laden (Icons, Manifest, DeepOBD-Konfigs)
#   4. Versions-Patch: Snapshot-Texte v2.1.0 → v2.2.0 (Interceptor-Wortlaut)
#   5. Verifikation (index.html vollständig, Chunks vorhanden, keine 2.1.0-Reste)
#
# Hinweis: /sw.js wird bewusst NICHT eingebettet – die App ist selbst offline-
# fähig, ein Service Worker würde nur Stale-Cache-Risiken bringen. /apk/* wird
# von der nativen App durch eine Info-Seite ersetzt (Download ist dort sinnlos).
#
set -euo pipefail

BASE="${BASE:-https://qflashk.vercel.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/apk-src/assets/www"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> 1/5 index.html laden ($BASE)"
mkdir -p "$WWW"
rm -rf "$ROOT/apk-src/assets"
mkdir -p "$WWW"
curl -fsSL --retry 3 "$BASE/" -o "$WWW/index.html"

echo "==> 2/5 _next/static per Fixpunkt-Analyse herunterladen"
declare -A SEEN=()
round=0
while :; do
  round=$((round + 1))
  # Referenzen aus allen bereits geladenen Textdateien sammeln
  # (absolute /_next/static/... UND relative static/immutable/... im Turbopack-Runtime-Chunk)
  find "$WWW" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -print0 \
    | xargs -0 grep -ohE '(_next/)?static/[a-z]+/[A-Za-z0-9/._-]+' 2>/dev/null \
    | sed 's|^_next/static/|/_next/static/|; s|^static/|/_next/static/|' \
    | sort -u > "$TMP/refs.txt" || true
  new=0
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    [ -n "${SEEN[$rel]:-}" ] && continue
    SEEN[$rel]=1
    dest="$WWW$rel"
    mkdir -p "$(dirname "$dest")"
    if curl -fsSL --retry 3 "$BASE$rel" -o "$dest"; then
      new=$((new + 1))
    else
      echo "    WARN: $rel nicht ladbar" >&2
      rm -f "$dest"
    fi
  done < "$TMP/refs.txt"
  echo "    Runde $round: $(wc -l < "$TMP/refs.txt") Referenzen, $new neue Dateien"
  [ "$new" -eq 0 ] && break
  [ "$round" -ge 8 ] && break
done

echo "==> 3/5 Public-Dateien (Icons, Manifest, Konfigs)"
PUB="/manifest.json /favicon-32.png /icons/icon-192.png /icons/icon-512.png /icons/icon-maskable-192.png /icons/icon-maskable-512.png /icons/apple-touch-icon.png /downloads/DeepOBD-Konfigs-M57-M47.zip"
for p in $PUB; do
  dest="$WWW$p"
  mkdir -p "$(dirname "$dest")"
  if curl -fsSL --retry 3 "$BASE$p" -o "$dest"; then
    echo "    OK $p ($(du -h "$dest" | cut -f1))"
  else
    echo "    WARN: $p nicht ladbar" >&2
    rm -f "$dest"
  fi
done

echo "==> 4/5 Standalone-Version-Patch (v2.1.0 -> v2.2.0, Interceptor-Architektur)"
find "$WWW" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -print0 | xargs -0 sed -i \
  -e 's/v2\.1\.0/v2.2.0/g' \
  -e 's/"2\.1\.0"/"2.2.0"/g' \
  -e "s/'2\.1\.0'/'2.2.0'/g" \
  -e 's/Standalone-Android-App (100 % offline)/Standalone-Android-App (Interceptor-Architektur, 100 % offline)/g' \
  -e 's/über v2\.0\.0\/v1\.3.x/über v2.1.0\/v2.0.0\/v1.3.x/g' \
  -e 's/und KOMPLETT eingebetteter Oberfläche: 100 % offline/und KOMPLETT eingebetteter Oberfläche mit Interceptor-Architektur (kein Server, kein Port): 100 % offline/g'

echo "==> 5/5 Verifikation"
[ -s "$WWW/index.html" ] || { echo "FEHLER: index.html leer" >&2; exit 1; }
grep -q '</html>' "$WWW/index.html" || { echo "FEHLER: index.html unvollständig" >&2; exit 1; }
ls "$WWW/_next/static/immutable/chunks" >/dev/null 2>&1 || { echo "FEHLER: keine Chunks" >&2; exit 1; }

REST="$(find "$WWW" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -exec grep -l '2\.1\.0' {} + 2>/dev/null || true)"
if [ -n "$REST" ]; then
  echo "WARN: 2.1.0-Reste in:" >&2
  echo "$REST" | head -5 >&2
fi

VOK="$(grep -rl 'v2\.2\.0' "$WWW" --include='*.html' --include='*.js' | wc -l)"
N="$(find "$WWW" -type f | wc -l)"
SIZE="$(du -sh "$WWW" | cut -f1)"
echo "    ✓ index.html vollständig"
echo "    ✓ $N Dateien gesamt, Größe $SIZE"
echo "    ✓ v2.1.0-Marker in $VOK Dateien"
echo "==> Snapshot fertig: $WWW"

# Info: externe Referenzen (sollten leer/neutral sein – App ist offline)
echo "    Externe URLs in index.html (Info):"
grep -ohE 'https?://[^"'"'"' >]+' "$WWW/index.html" | grep -v 'qflashk.vercel.app' | sort -u | head -5 || true
