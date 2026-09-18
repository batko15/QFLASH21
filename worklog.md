# QFLASH21 – Worklog

---

Task ID: 1
Agent: Z.ai Code (Hauptagent)
Task: Projekt rekonstruieren, Fehler suchen und beheben („optimiere es, suche nach Fehlern und behebe es")

Work Log:
- Befund: Projektverzeichnis war KOMPLETT LEER (nur leerer Git-Initial-Commit, keine src/, keine package.json). Alte Codebasis unwiederbringlich verloren.
- Next.js 16 + React 19 + TypeScript 5 + Tailwind 4 + Prisma 6 + Zustand 5 von Grund auf aufgebaut.
- KWP2000-Protokollstack neu implementiert:
  - `src/lib/kwp/types.ts` – alle Diagnose-Typen (DtcEntry, EcuIdent, QfSerialPort, …)
  - `src/lib/kwp/protocol.ts` – ISO 14230 Framing (0x80|len, Prüfsumme, NRC-Tabelle)
  - `src/lib/kwp/serial-client.ts` – Web Serial Client: 5-Baud-Init über BREAK-Signal (200 ms/Bit, LSB), adaptive Echo-Erkennung (hasEcho), Service-Validierung, 0x78-Handling, drainInitAck, USB-Filter für FTDI 0403:6001 / CH340 / CP2102, Baudraten 10400/38400/125000
  - `src/lib/kwp/mock.ts` – MockSerialPort: virtuelles DDE4.0 mit 5-Baud-Flanken-Dekodierung (9 Einheiten vor Stop-Bit), K-Line-Echo, Ident/DTC/Live/Security/Flash-Services, 512 KiB Fake-Flash mit korrekten CR2-Prüfsummen
  - `src/lib/kwp/dde4.ts` – DDE4-Profil: Ident-Services 0x1A/0x89–0x9F, DTC-Tabelle (30 EDC15-Fehlernummern), Status-Bit-Dekodierung, 4 Live-Blöcke (0x03/0x07/0x13/0x15), Security-Access-Algorithmus, Routinen
  - `src/lib/kwp/checksum.ts` – Bosch CR2: 16-KiB-Bänke, 2×16-Bit-Summenwörter LE, 16 KiB geschützt
  - `src/lib/kwp/bin.ts` – FULL/CAL-Erkennung, Diff, Hex-Dump, Download
- Zustand-Store `src/store/flasher.ts`: Verbindung (echt/Simulator), Ident, Fehlerspeicher normal+Schatten (0x18 FF00 / 0xFD00, löschen 0x14), Live-Polling 600 ms, Flash-Lesen (0x35→0x76/0x36→0x37), Löschen (0x31/FF00), Schreiben (0x27 Security→0x34→0x36→0x37→0x31/FF01), OperationLog-Reporting an /api/logs
- UI: 8 Tabs (Übersicht, Verbindung, ECU-ID, Fehlerspeicher, Live-Daten, Lesen/Schreiben, Prüfsumme, Protokoll), Android-OTG-Anleitung, Schreib-Gate (Phrase „QFLASH21" + Spannung ≥12 V + Backup-Pflicht), KI-Werkstattanalyse, Sticky Footer, Dark/Light
- Backend: `/api/logs` (POST/GET, Prisma OperationLog), `/api/analyze-dtc` (z-ai-web-dev-sdk LLM mit Offline-Fallback)
- 6 gefundene und behobene Fehler:
  1. ESLint-Config: FlatCompat inkompatibel mit eslint-config-next@16 → native Flat-Arrays
  2. Operator-Präzedenz-Bug: `dataSeq !== seq & 0xff` → `!== (seq & 0xff)` (Store, Flash-Lesen)
  3. Mock-Sequenzreihenfolge: ECU sendete Upload-Seq erst NACH Inkrement → Client erwartete 0 → Sequenzfehler
  4. 5-Baud-Dekodierung im Mock zählte Flanken statt Dauern → gleichläufige Bits (Adresse 0x12) wurden nie erkannt → Neuimplementierung über Flanken-Dauern (Vielfache von 200 ms)
  5. K-Line-Echo-Bug (HAUPTBUG): Echo wurde als gültige Antwort geparst; verspätete Init-Quittung `12 ED` vergiftete Puffer → adaptive discardEcho mit Pre-Skip, readFrame resynced nur über 0x80-Frames, sendRequest validiert erwarteten Service (mit expectService-Override für 0x76-Ack→0x36)
  6. Hydration-Fehler: Badge (div) in <p> in 3 Komponenten; ThemeToggle setState-in-Effect → useSyncExternalStore
- Weitere Fixes: @types/w3c-web-serial Version, next.config eslint-Key (Next 16 entfernt), tsconfig exclude skills/, fehlende dtcReadAt-Selektion, z-ai-web-dev-sdk installiert

Stage Summary:
- **Akzeptanzkriterium 1 (Android USB-C)**: Web Serial mit FTDI/CH340/CP2102-Filtern, Android-Erkennung + OTG-Schrittanleitung im Verbindungstab. Browser-Test: Verbindung, Ident, DTC, Live, Flash-Lesen laufen komplett durch.
- **Akzeptanzkriterium 2 (Fehlerspeicher lesen)**: E2E im Browser verifiziert – normaler Speicher (00025 Luftmassenmesser, 17964 sporadisch) + Schattenspeicher (00087) gelesen, KI-Analyse erzeugt deutsche Werkstatt-Hinweise mit BMW-Teilenummern, Löschen bestätigt („Keine Einträge").
- Ebenfalls E2E getestet: Ident (DDE4.0 EDC15C4-6-BMW, SW V41 7759), Live-Daten (799 1/min, 81 °C), Flash-Lesen 524288 Bytes in ~20 s, BIN-Upload mit 2 absichtlich fehlerhaften Bänken → CR2-Korrektur → 32/32 OK, Prüfsummentabelle.
- Lint: 0 Fehler/0 Warnungen. tsc: sauber. Keine Hydration-/Konsolenfehler.
- Footer: exakt am Dokumentende verifiziert (footerBottom == docH), kein horizontales Overflowing bei 390 px.

Bekannte Restpunkte:
- Write-Pfad (0x34/0x36-Schreiben + Erase) ist implementiert, aber nur über den Simulator frei geschaltet – Realtest am Fahrzeug mit Backup-Pflicht.
- Nächste sinnvolle Schritte: CAL-Vergleich zweier BINs als Visu, Kennfeld-Editor, BIN-Diff-Viewer mit Hex, Auto-Reconnect, WebUSB-Fallback.

---
Task ID: 2
Agent: Z.ai Code (Hauptagent)
Task: Android-Direktnutzung (PWA) einrichten + GitHub-Repo erstellen (batko15/QFLASH21)

Work Log:
- Recherche (web-search): Web Serial API ist auf Android-Chrome seit Version 138 NATIV verfügbar (caniuse + chromestatus bestätigt). Kein WebUSB-Fallback nötig – Honor Magic Pro 8 mit aktuellem Chrome erfüllt das.
- PWA-Setup:
  - `public/manifest.json`: name/short_name, standalone, theme #18181b, lang de, Maskable-Icons, Shortcuts (/?tab=verbindung, /?tab=fehlerspeicher)
  - App-Icon per KI generiert (`public/icon-source.png`, 1024²), via `scripts/make-icons.mjs` (sharp) zu 192/512/maskable/apple-touch-180/favicon-32 verarbeitet
  - `public/sw.js` Service Worker v1: Precache-Shell, Network-First für Navigationen (Offline-Fallback /), Cache-First für /_next/static + Icons, /api/ NIEMALS gecacht
  - `layout.tsx`: metadata.manifest, icons (32/192/512/apple), appleWebApp (capable, black-translucent), viewportFit cover (Safe-Areas)
- `src/components/qf/pwa.tsx`: SwRegister (SW-Registrierung) + InstallPwaButton (beforeinstallprompt, Standalone-Erkennung über matchMedia + useSyncExternalStore – lint-sauber)
- `qf-app.tsx`: InstallButton im Header, ?tab=-Deeplinks hydration-sicher via useSyncExternalStore (kein setState-in-Effect)
- 2× ESLint-Fehler (react-hooks/set-state-in-effect) behoben: Tab-Deeplink + Install-Button auf useSyncExternalStore-Muster umgestellt
- Connection-Panel: Browser-Hinweise aktualisiert („Android: Chrome ≥ 138, Desktop: Chrome/Edge ≥ 89, HTTPS nötig“)
- GitHub: Repo batko15/QFLASH21 (public) via API erstellt; Commit f9c5feb (PWA) + c5d86fe (Cleanup) gepusht
- Repo-Bereinigung: .env, skills/, download/, tsconfig.tsbuildinfo aus Git entfernt (waren im Vorgänger-Commit getrackt); .env.example ergänzt; Token aus git remote config entfernt (Push nur einmalig in URL)
- Hinweis: .env (nur lokale SQLite DATABASE_URL, kein echtes Secret) verbleibt in Git-Historie von Commit 6f7beec – falls relevant, History-Rewrite + Force-Push nötig

Stage Summary:
- **Android-Direktnutzung steht**: App ist jetzt als PWA installierbar (Chrome → „App installieren“ → Icon auf Homescreen, Vollbild ohne Browser-Leiste). Offline nutzbar (Service Worker). Web Serial funktioniert nativ ab Android-Chrome 138.
- Browser-Verifikation (agent-browser, 390×844): Rendering fehlerfrei, 0 Konsolen-/Hydrationsfehler, Manifest+SW aktiv (Scope /), ?tab=-Deeplinks springen korrekt, Footer exakt am Dokumentende, kein Horizontal-Scroll.
- Kein Regression: Golden Path Simulator → Verbindung → Ident (DDE4.0) → DTC-Lesen (2 normal + 1 Schatten) E2E bestätigt.
- Lint: 0 Fehler/0 Warnungen. tsc: sauber.
- Repo: https://github.com/batko15/QFLASH21 (main, sauber ohne Secrets)

Nächste Schritte (Priorität):
1. Nutzer-Anleitung im Übersicht-Tab: „Auf Android installieren“-Karte mit 3 Schritten
2. GitHub Pages / permanente URL für Handy-Zugriff (statischer Export ohne API → localStorage-Fallback für Logs)
3. WebUSB-FTDI-Fallback für Chrome < 138 (ältere Handys)
4. Realtest am Fahrzeug: 5-Baud-Init → Ident → DTC mit K+DCAN-Kabel am Honor

---
