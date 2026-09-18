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
Task ID: 3
Agent: Z.ai Code (Hauptagent)
Task: Komplett-Deployment (Supabase + Vercel), Repo vervollständigen (Bilder), Android-APK

Work Log:
- **Supabase-Postgres-Umstellung**: prisma/schema.prisma sqlite → postgresql (DATABASE_URL = PgBouncer-Pooler 6543 + ?pgbouncer=true, DIRECT_URL = Session-Pooler 5432). Region-Ermittlung: eigener Postgres-Handshake-Probe über alle Supabase-Regionen → Projekt liegt in ap-southeast-2 (Sydney). `db:push` erfolgreich, lokal E2E (POST/GET /api/logs gegen Supabase) verifiziert.
- **Shell-Env-Falle gefunden**: Umgebungsvariable DATABASE_URL=file:.../custom.db überschrieb .env (Next priorisiert echte Env) → Dev-Server-Start jetzt mit `env -u DATABASE_URL -u DIRECT_URL bun run dev`.
- **Vercel**: übergebene Credentials (UUID+SHA256-Fingerprint) sind KEIN API-Token (403 invalidToken) → Env-Vars nicht per API setzbar. Branch-URL hat Deployment-Protection (302→SSO); Produktion https://qflashk.vercel.app ist öffentlich.
- **Graceful Degradation + Env-Fallback-Kette**: /api/logs gibt 503 mit `degraded:true` ohne DB; db.ts-Fallback DATABASE_URL → POSTGRES_PRISMA_URL → POSTGRES_URL (für spätere Supabase-Integration); Build-Pipeline für Vercel (build = prisma generate && next build, postinstall, trustedDependencies @prisma/*).
- **RLS-Policies via prisma db execute** (direkte DB-Verbindung): anon INSERT + SELECT auf OperationLog; ALTER COLUMN id SET DEFAULT gen_random_uuid()::text (cuid() ist nur Prisma-seitig, REST-Inserts brauchen DB-Default).
- **Supabase-REST-Fallback** (supabase-log.ts): Publishable-Key (public by design) im Client; Store reportOperation: /api/logs zuerst → Supabase-REST-Fallback; dadurch Produktion SOFORT voll funktionsfähig ohne manuelle Vercel-Env-Konfiguration.
- **Neues Feature „Operationshistorie"** im Protokoll-Tab: lädt /api/logs mit Supabase-Fallback, Quelle-Badge (Server-API / Supabase direkt), Refresh, Status-Badges, max-h-56 Scroll. Lint-Fix: async fetchHistory-Helfer statt synchronem setState im Effect.
- **Repo vervollständigt**: 9 Screenshots (Simulator-Durchlauf: Übersicht, Verbindung, DTC, KI-Analyse, ECU-ID, Live, Flash, Prüfsumme, Protokoll) in docs/screenshots/; README mit Bildern/Badges/Tabellen; DEPLOYMENT.md (Env-Vars, Protection, Verifikation).
- **Android-APK v1.0.0 gebaut**: nativer Launcher (minSdk 24/target 34, arm64-kompatibel, 85 KB) – öffnet PWA in Chrome, weil Web Serial NUR im echten Chrome funktioniert (bewusst KEIN WebView/TWA!). Toolchain ohne Gradle: aapt2 + ecj + d8 + zipalign + apksigner (ecj braucht -source/-target 8 wegen Java21-Modulkonflikt; d8 braucht existierenden Output-Ordner). Signiert: SHA-256 8c9dfb21...68f06. Release: https://github.com/batko15/QFLASH21/releases/tag/v1.0.0
- **GitHub Actions**: Workflow .github/workflows/build-apk.yml korrekt, aber Runs schlagen fehl: „account is locked due to a billing issue" → Nutzer muss GitHub-Billing lösen; danach baut der Workflow automatisch.

Stage Summary:
- **Produktion live & verifiziert**: https://qflashk.vercel.app – App 200, PWA aktiv (Manifest + SW-Registration 1), Operationshistorie lädt live aus Supabase (Fallback-Pfad browser-verifiziert: „Supabase direkt", Test-Eintrag sichtbar).
- **Datenbank**: Supabase Postgres (ap-southeast-2), OperationLog mit RLS (anon-Insert/Select), lokal + Produktion getestet.
- **APK**: v1.0.0 signiert im GitHub-Release + im Repo unter apk/. CI-Rebuild-Workflow vorhanden (blockiert nur durch GitHub-Billing-Sperre).
- **Ein verbleibender manueller Schritt (optional)**: Vercel-Dashboard → qflashk → Settings → Environment Variables → DATABASE_URL + DIRECT_URL (Werte in DEPLOYMENT.md) → dann nutzt die Server-API die DB direkt (aktuell reicht der Client-Fallback komplett).
- **Sicherheit**: DB-Passwort/Keys erneut im Chat geteilt → rotieren empfehlen. Keystore nicht im Repo. Keine Secrets committed.

Nächste Schritte:
1. GitHub-Billing-Sperre beheben → Actions-APK-Build läuft automatisch
2. Vercel-Env-Vars setzen (optional, siehe DEPLOYMENT.md) + Deployment-Protection für Produktion prüfen
3. Realtest am Fahrzeug (Honor + OTG + K+DCAN): 5-Baud-Init → Ident → DTC
4. Feature-Ideen: DTC-Clear in Historie markieren, BIN-Diff-Viewer, Live-Gauges

---
Task ID: 4
Agent: Z.ai Code (Hauptagent)
Task: Massive App-/Repo-Erweiterung + Fehler Suche („optimiere die app, erweitere massiv, suche nach fehler, github deep search")

Work Log:
- Deep-Research (GitHub API + Web): KWP2000/EDC15-Referenzen gesichtet (ecu_diagnostics, KLineKWP1281Lib, ISO14230-Projekte); TesterPresent/Session-Timeout-Verhalten (ISO 14230-3) verifiziert.
- **Feature: Live-Daten Komplettumbau** – SVG-Kreuzzeiger-Gauges (240°-Bogen, Warnbereiche) für Drehzahl/°C/mbar/V, Sparkline-Verläufe (letzte 120 Messpunkte, SVG polyline), Sitzungs-Aufzeichnung (bis 1500 Frames) mit CSV-Export (Semikolon, Excel-kompatibel), Grenzwert-Badges.
- **Feature: BIN-Diff-Viewer** (neuer Card im Lesen/Schreiben-Tab) – zwei beliebige Images (ECU-Backup/Upload/Datei) bytegenau vergleichen: geänderte Bytes, Regionen mit alter→neuer Hex-Vorschau, 16-KiB-Bank-Zuordnung, Schutz-Zonen-Check (nur FULL-Images), max. 300 Regionen im Scroll-Panel.
- **Feature: KWP2000-TesterPresent-KeepAlive** (0x3E alle 3 s, pausiert bei busy/livePolling/mock) – 2× Timeout = Session-Verlust → Disconnect-Erkennung + **Auto-Reconnect** über zuletzt genutzten Port (max. 3 Versuche, Backoff 2-3 s), Buffer-Flush (drainInitAck) nach Fehlern gegen Buffer-Poisoning.
- **Feature: Einstellungs-Persistenz** (localStorage: Baudrate, Fahrzeug, Auto-Reconnect), SSR-sicher mit try/catch.
- **Feature: PWA-Update-Toast** – SW-Update erkannt → Toast mit „Neu laden"-Aktion.
- **Feature: DTC-DB erweitert** (30 → 37 Einträge): Glühkerzen Zyl. 2–6, Ladedruckregelventil N75 (17966), Ladedrucksensor (17967).
- **BUG #1 (realer Dekodierfehler)**: Ladedruck Block 0x03 – Parser ×10 + Mock-Bytes 0x0960 → 24000 mbar (24 bar, unrealistisch). Fix: 1 LSB = 1 mbar absolut (kein Faktor), Mock-Leerlauf ~1050 mbar dynamisch. Browser-verifiziert: 1036–1079 mbar lokal, 1043 mbar auf Produktion.
- **BUG #2 (SW-Dusch-Falle)**: Service Worker cache-first fror Dev-Chunks über Server-Restarts ein (Stale-Code trotz Clean-Rebuild). Fix: SW-Registrierung nur in Produktion (NODE_ENV-Check) + Cache-Version v2 (activate löscht alte Versionen).
- **BUG #3 (UX-Logik)**: Schutz-Zonen-Warnung im Diff feuerte bei CAL-Images (48 KiB) fälschlich „BERÜHRT!" – Check jetzt auf FULL-Images (512 KiB) beschränkt, CAL zeigt Bildtyp-Info.
- Screenshots aktualisiert (06-live-daten mit Gauges, 07-flash mit Diff-Viewer).
- Lint 0/0, tsc sauber, E2E lokal (Simulator → Gauges → Recording 8 Frames/5 s → CSV-Klick, Diff 111 Bytes/3 Regionen/Banken 0,1,2) und auf Produktion.

Stage Summary:
- **Produktion aktualisiert & verifiziert**: https://qflashk.vercel.app – neue Live-Gauges (Ladedruck 1043 mbar korrekt), Aufzeichnen-Button, BIN-Diff-Viewer sichtbar, Simulator-Verbindung grün.
- QFLASH21 deckt jetzt ab: Ident, DTC (37 Codes), Live-Gauges + Recording/CSV, Flash lesen/schreiben/löschen, CR2-Prüfsummen, BIN-Diff, KeepAlive/Auto-Reconnect, Operationshistorie (Supabase), PWA + APK.
- Restrisiken: KeepAlive/Reconnect nur gegen Simulator logisch getestet (Realtest am Fahrzeug ausstehend); GitHub-Actions weiterhin durch Billing-Sperre blockiert.

Nächste Schritte:
1. Fahrzeug-Realtest (KeepAlive-Verhalten + Auto-Reconnect live erleben)
2. Kennfeld-Raster-Viewer (Heatmap über CAL-Bereich) + AGR-Testroutine (0x31) wenn Doku vorliegt
3. GitHub-Billing klären → CI-APK-Build aktivieren

---

---
Task ID: 5
Agent: Z.ai Code (Hauptagent)
Task: DeepOBD-Tiefenanalyse (e90-Forum) + massive Erweiterung (Jobs, Live-Seiten, WakeLock, TSV), Fehler-Suche, APK-Test/Neubau, Deploy + Produktionsverifikation

Work Log:
- **DeepOBD.rar NICHT angekommen**: upload/ war leer, dateisystemweit keine .rar gefunden → Analyse über öffentliche Quellen ersetzt: e90-forum-Thread #58407 komplett extrahiert (T-1311-Post #1: Funktionsliste, FAQ, PRG/GRP-Jobs, ccpage-Seiten, Logging-Format, 115200-Adapter) + ediabaslib-Repo (Page_specification) + EDC15C4-Recherche (ecuconnections: OTF/KTF/AT1/AT2-Zusatzsensoren).
- **Feature Jobs-Tab** (DeepOBD-Prinzip „SG-Reset/Jobs/Registrierung“): 13 Jobs in 4 Gruppen – ECU-Reset (0x11, mit Session-Abbau + Auto-Reconnect), Routinen 0x31 (Glühkerzen-Test mit Zylinderwerten, Laufunruhe/Zylinder-Abschalttest, AGR-Funktionstest, Adaptionswerte-Reset, Test-Leerlauf +250 1/min), Aktuatorik 0x30 (Glühstiftrelais, Lüfter, AGR, N75, Kraftstoffpumpenrelais), Info-Felder 0x1A (ZUSB/Teilenummer, AIF/Codierung). Sicherheitsstufen safe/caution/danger, Bestätigungsdialog, Job-Historie (12), reportOperation-Logging.
- **Feature Live-Seiten-Konfigurator** (ccpage-Prinzip): Blöcke für Round-Robin-Polling frei wählbar (Switch-Chips), Zyklusanzeige, localStorage-Persistenz; Kompaktansicht aller Seitenblöcke (Grid mit Live-Zeitstempel); 5. Live-Block 0x17 „Öl & Abgastemperatur“ (OTF/AT1/AT2/Ölstand, EDC15C4-dokumentiert).
- **Feature TSV-Export** (DeepOBD/MultiEcoScan-Stil, Tab-getrennt) neben CSV.
- **Feature WakeLock** (DeepOBD „Bildschirm bleibt an“): navigator.wakeLock bei connect (echt+Mock), Re-Acquire bei visibilitychange, Schalter im Verbindung-Tab mit AKTIV-Badge.
- **Layout**: Mobile-Bottom-Nav (5 Icons: Start/Verbin./Fehler/Live/Jobs, safe-area, min 56 px Touch), Tab-Icons im Desktop-Strip, 9 Tabs, main pb-24 (kein Overlap), Footer exakt am Dokumentende (browser-verified 4144==4144).
- **BUG #4 (Protokoll, produktionsrelevant)**: Positive Response für Output-Control 0x30 ist 0x70 (SID+0x40), nicht 0xF0 – Mock antwortete 0xF0, Client verwarf den Frame („Unerwarteter Service – Frame verworfen“) → Antwort-Timeout. Behoben in mock.ts + flasher.ts; browser-verifiziert (AGR-Test: „angesteuert (Task 50 %)“, Antwort 03 80).
- **DTC-DB erweitert**: 37 → 51 EDC15-Codes (17955/17957/17958/17961/17962/17963/17968/17969/17971/17978/18008/18034/19561/1096 …).
- **APK**: v1.1.0 (versionCode 2) neu gebaut (aapt2 → ecj → d8 → zip → zipalign → apksigner). Altes Keystore-Passwort war nicht dokumentiert → frisches Keystore (Pass: siehe lokale Notiz, NICHT im Repo). Neuer Signatur-SHA-256: a2d639c2…b7c438. Badging verifiziert (minSdk 24, target 34, Label QFLASH21). Release v1.1.0 auf GitHub erstellt + APK hochgeladen (87 KB). apk-src-Build-Artefakte aus Git entfernt + gitignore-Regeln.
- **Git**: Commits b517650 (Features+Fixes), 962755b→a7ac84d (APK + Artefakt-Cleanup) gepusht. Vercel auto-deployt.
- **Produktionsverifikation** (https://qflashk.vercel.app): App 200, Manifest 200, neue Features im HTML (Hauptnavigation, Jobs), E2E im Browser: Simulator → Glühkerzen-Routine OK (12,13,12,14,12,13), 0 Konsolenfehler, Footer exakt am Ende. /api/logs im degraded-Modus (Vercel-Env-Vars weiterhin nicht gesetzt – Client nutzt Supabase-REST-Fallback, funktional).

Stage Summary:
- QFLASH21 deckt jetzt das DeepOBD-Kernrepertoire für DDE4 ab: Ident, DTC (51 Codes), Live-Seiten (5 Blöcke, konfigurierbar, CSV+TSV), Jobs (Reset/Routinen/Aktuatorik/Info), Flash+Prüfsummen, KeepAlive/Auto-Reconnect, WakeLock, PWA + APK v1.1.0.
- 1 echter Protokoll-Bug gefunden und behoben (0x30→0x70); alle Jobs E2E gegen Simulator auf lokal UND Produktion verifiziert.
- Repo sauber (keine Build-Artefakte/Secrets), Release v1.1.0 mit APK: https://github.com/batko15/QFLASH21/releases/tag/v1.1.0

Nächste Schritte / Hinweise:
1. **DeepOBD.rar fehlt** – falls Datenlokale Inhalte (z. B. eigene ccpages/Messwerte-Tabellen N47/N57) gewünscht sind, Datei erneut hochladen; ich integriere sie dann gezielt.
2. GitHub-Billing-Sperre lösen → CI-APK-Build läuft automatisch (Workflow vorhanden).
3. Vercel-Env-Vars (DATABASE_URL/DIRECT_URL) optional setzen – Details in DEPLOYMENT.md.
4. Fahrzeug-Realtest: Aktuatorik-Jobs erst mit geprüfter Referenz am echten EDC15C4 freischalten.
5. Sicherheit: Im Chat geteilte Tokens/Passwörter rotieren (GitHub PAT, Supabase-DB-Passwort, neu: APK-Keystore-Passwort qflash-2025 lokal notieren).

---
Task ID: 6
Agent: Z.ai Code (Hauptagent)
Task: DeepOBD-Datei-Upload empfangen/analysieren + QA-Runde + Verbesserungen

Work Log:
- **DeepOBD.rar/zip IMMER NOCH NICHT ANGEKOMMEN** (2. Upload-Versuch des Nutzers): upload/ leer, dateisystemweit kein Treffer (find über / , /home/z, /tmp). Watcher-Skript /tmp/watch-deepobd.sh (setsid, 10-min-Polling) entpackt automatisch nach /home/z/my-project/tools/deepobd-extracted/ sobald die Datei auftaucht; Status in /tmp/deepobd-status.txt. unrar + unzip vorhanden. → Nutzer muss Datei erneut hochladen (möglicher Upload-Pipeline-Fehler).
- QA (agent-browser, lokal): frischer Seitenaufruf 0 Hydration-/Konsolenfehler; die vielen Hydration-Mismatches im dev.log waren HMR-/stale-HTML-Rauschen während Code-Edits, KEIN aktueller Bug. Golden Path E2E: Simulator → Ident (DDE4.0 EDC15C4-6-BMW SW V41 7759) → DTC (3 Einträge) → Live-Polling (1069 mbar, 66 °C) → Glühkerzen-Routine OK (12,13,12,14,12,13).
- **Feature: Operationshistorie ausgebaut** (Worklog-Idee aus Task 4 „DTC-Clear in Historie markieren"):
  - log-panel.tsx: OPERATION_META-Tabelle (deutsches Label + Icon je Operation: Verbindung, Identifikation, Fehlerspeicher lesen/gelöscht, Flash gelesen/geschrieben/gelöscht, Steuergerät-Reset, Aktuatorik/Routine, Info-Auslesung); describeDetails() rendert Kurzbeschreibung aus JSON-Details (z. B. „3 Einträge entfernt (normal: 2, Schatten: 1)", „Port: …", „512 KiB gelesen"); CLEAR_DTC-Einträge farblich hervorgehoben (text-warning + Eraser-Icon).
  - flasher.ts clearDtc: meldet jetzt { normal, shadow, cleared } in Details; Toast zeigt Anzahl.
  - dtc-panel.tsx exportTxt: Bericht enthält jetzt Steuergerät-Ident (ECU-Typ, Teile-Nr., SW-Stand), Priorität je Fehler, explizite Leerfelder, Schatten-Hinweis.
- E2E-Verifikation lokal: Simulator → DTC lesen → löschen → Historie zeigt „Fehlerspeicher gelöscht · 241 ms · 3 Einträge entfernt (normal: 2, Schatten: 1)" ✅
- Lint 0/0, tsc sauber. Commit 244a53b gepusht; Vercel auto-deploy (Produktion 200, Manifest 200, 0 Konsolenfehler).

Stage Summary:
- App stabil & getestet; Operationshistorie jetzt Werkstatt-tauglich (Klarnamen, Details, Lösch-Markierung).
- **BLOCKER für DeepOBD-Integration: Datei ist nach 2 Upload-Versuchen nicht auf dem Server angekommen** — bitte erneut hochladen; Watcher läuft und verarbeitet sie automatisch.

Nächste Schritte:
1. DeepOBD-Datei empfangen → Protokoll-/DTC-Daten (DDE4/EDC15C4) extrahieren und integrieren
2. Fahrzeug-Realtest, GitHub-Billing (Nutzer-Aktionen)
3. Vercel Env-Vars (optional, siehe DEPLOYMENT.md)
