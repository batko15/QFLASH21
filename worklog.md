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
