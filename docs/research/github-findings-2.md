# GitHub-Deepweb-Research Runde 2 (Task 9-a)

Datum: 2026-09-18 · Agent: general-purpose (9-a) · Vorläufer: docs/research/github-findings.md (Task 7-a, NICHT wiederholt)

Methodik: 8 z-ai-Web-Suchen (web_search) + 5 unauthentifizierte GitHub-API-Suchen (search/repositories) + MDN browser-compat-data + caniuse-Raw + Auswertung der 4 lokalen Klons aus Task 7 (`/tmp/qf7a/clones/…`). 1 Klon-Verzeichnis (`kmalinich/deepobd-configs`) wurde erstmals tiefer ausgewertet.

---

## Teil 1: Auswertung der öffentlichen DeepOBD-Konfig-Repos

Durchsucht: Dekon01/DeepObdE46Config, kmalinich/deepobd-configs, uholeschak/ediabaslib (+ radelbro/BimmerDis). Details und Extraktion → `src/lib/kwp/deepobd-knowledge.ts`.

### Zentrale (ernüchternde) Befunde für DDE4/EDC15C4

1. **Kein DDE4-SGBD/.prg öffentlich.** Dekon01 (E46!) enthält ausschließlich Benziner (MS430DS0/M43TU, MSS52DS1, GS8604, IHKA, IKI, ZUHEIZ) – keine Diesel-Seite. ediabaslib bringt nur `BmwDeepObd/Xml/{E90,E61,E61R,G31}` (d_motor/d_dsc …, CAN-Ära ≥ DDE5). BimmerDis-Beispiele: me9_4n, mev9n46, ms430ds0, szm46 – alle Benziner.
2. **Keine DTC-Texte.** `Translation.xml.zip` in Dekon01 entpackt → `<?xml?><LanguageCache />` (leer). Die `.ccpage`-Dateien definieren nur das `read_errors`-**Ergebnisraster** (F_ANZ_NR; F_ORT_NR; F_ORT_TEXT; F_ART1–5; F_UW1–5 …), nicht die Texte selbst. Die ORT-Texte stecken proprietär im SGBD (.prg) bzw. entstehen zur Laufzeit in der App. → `DEEP_OBD_DTC_TEXTS` bleibt **absichtlich leer** (Zero-Trust: keine erfundenen Codes).
3. **Was dennoch verifiziert extrahierbar war** (jetzt in deepobd-knowledge.ts):
   - `DEEP_OBD_ERROR_RESULTS` (32 Feldnamen des STATUS_FEHLER_LESEN-Rasters) – deckt sich mit dem 28-Byte-FSP-Eintrag aus dem Bosch-EDC15C-PDF (Task 7-a).
   - `DEEP_OBD_JOBS` (13 STATUS_*-Jobs aus kmalinich B803819/DME_DDE.ccpage, sgbd MS450DS0) – **ABER**: die repo-eigene Errors.ccpage labelt diese ECU als „MS45.1“ → Benziner-DME, NICHT DDE4. Als Bosch-Namenskonventions-Referenz gelabelt.
   - `DEEP_OBD_MWB` (30 Einträge aus kmalinich E90/DDE.ccpage + A778780/D_MOTOR/jobs/STATUS_MESSWERTBLOCK_LESEN.ccpage, sgbd „d_motor“ = DDE5/EDC16): args-Namenskonvention (I*/S* = Ist/Soll), Einheiten und C#-Umrechnungsformeln (UBATT2/1000, Raildruck ×14.5038 bar→psi, LADEDRUCK −1007 hPa Offset, DPF-Strecke /1000) – Referenz für die Darstellung der QFLASH21-LID-0x20–0x2F-Scans.
   - Übersetzungs-Schlüsselformat `!JOB#JOB#RESULT` / `!ECU#SGBD` (BmwDeepObd.xsd) für einen späteren ccpage-Import.

**Fazit Teil 1:** Ersatzquelle für die nie angekommene DeepOBD.rar liefert für DDE4 **keine** konkreten DTC-Texte/MWB-args. Echte DDE4-Klartexte erfordern das BMW-DDE4-SGBD (INPA-/ISTA-Datenstand) oder eine beim Fahrzeugnutzer erzeugte Translation.xml. Das SBB-Format (ccpage/XSD) ist aber vollständig dokumentiert und ohne PRG ansteuerbar (Jobs STATUS_*/FEHLER_LESEN direkt als KWP-RIDs abbildbar) – genau das, was QFLASH21 bereits tut.

---

## Teil 2: Neue GitHub-Funde (Runde 2, nicht in Task 7)

### Alle gefundenen Repos (URL · ★ · Beschreibung · Nutzwert für QFLASH21)

| Repo | ★ | Beschreibung | Nutzwert |
|---|---|---|---|
| LeZed97/ZedSuite | 120 | „Free ECU map editor — any binary, automatic detection on VAG Bosch EDC15/EDC16. 100% local, open source“ (aktiv, push 2026-09-14) | **Hoch**: Muster für automatische Map-Erkennung; Candidate README-Toolbox „XDF/Damos-Editor“ |
| bri3d/VW_Flash | 543 | VW-AG-UDS-Flashing (Kompression, Verschlüsselung, RSA-Bypass, Checksummen) | Mittel: Architektur-Referenz für Flash+Checksum-Pipeline |
| aster94/Keyword-Protocol-2000 | 322 | KWP2000-Arduino-Library (Suzuki) | Mittel: 5-Baud-Init/Timeout-Referenz |
| muki01/OBD2_K-line_Reader | 204 | K-Line ISO9141/ISO14230-Reader für ESP32/Arduino (5-Baud + Fast Init) | **Hoch**: Toolbox (Android-K-Line-Apps/Hardware-Ref) |
| rnd-ash/OpenVehicleDiag | 1002 | Rust-ECU-Diagnose-App (PassThru) | Mittel: generische Diagnose-UI/Protokoll-Referenz |
| oxibus/automotive_diag | 101 | Rust-Crate: UDS/KWP2000/OBD-II/DoIP-Parser | Mittel: Protokoll-Parser-Referenz |
| muki01/Bosch_EDC15_EEPROM_Tool (+ Fork RJ-6463) | 6 | EEPROM-Tool: IMMO-Status, Odometer, Login-Code (lokal bereits geklont) | Mittel: EEPROM-LAYOUT-Referenz (93C56), IMMO-Bytes |
| NickTullos/edc15vm-flash-editor | 6 | .NET-7-Tool: ALH EDC15V/VM-Flash-Inspektion, **automatische DTC-Code-Entdeckung** | **Hoch**: identische Idee auf DDE4-Dumps übertragbar (SW-spezifische DTC-Tabelle aus 23 Mursteinen-Dumps ableiten!) |
| krook1024/edc15-eoi · edc15-swiss-knife · edcp | 17/7/3 | EOI-Rechner, EDC15-Parser (MSA15/EDC15) | Mittel: Parsing-Referenzen |
| PL125/edc15p-disassemble | 8 | EDC15P-Disassembler | Niedrig |
| mtx-electronics/vag-checksum-fix | 2 | Checksum-Berechnung VAG EDC15 | **Hoch** (Pfadmuster): gegen QFLASH21 checksum.ts abgleichen |
| paceworx-store/EDC15C13-Checksum-Correction | 0 | „Creates valid checksum for EDC15C13 and possibly others“ | **Hoch**: C13 ist C4-Schwester (EDC15C-Familie!) – Algorithmen auf C4 testbar |
| muki01/OBD2_K-line_Reader s.o. | – | – | – |
| SchoepsLabs/webserial-android | 6 | „Web Serial and WebUSB for Android — one USB bridge for every hardware web app“ (inoffiziell) | **Hoch**: Fallback für Android-Geräte ohne Chrome ≥148 |
| selevo/WebUsbSerialTerminal | 15 | WebUSB-CH340-Terminal, läuft im Android-Browser | Mittel: WebUSB-Fallback-Muster |
| Uzlopak/react-native-web-serial-api | 3 | W3C Web Serial für React Native/Android (USB-serial) | Niedrig |
| (Bestätigung) GabrielStanescu/BMW_M57_EDC15C4 · Mursteinen/BMW-DDE4-EDC15c4-EcuID · batko15/QFLASH21 | 4/2/0 | bekannte Treffer aus Task 7 | – |

Nicht gefunden (explizit): ein Repo mit **DDE4-DTC-Klartext-Tabelle**, ein **EDC15C4-spezifischer Checksum-Corrector** (nur C13/VAG), ein **BMW-K-Line-ccpage für DDE4**.

### Top-5-Integrations-Empfehlungen

1. **NickTullos/edc15vm-flash-editor** – dessen „DTC-Discovery“-Ansatz über EDC15-Flash-Dumps auf die 23 verifizierten EDC15C4-Dumps (Mursteinen, bereits lokal) übertragen → generiert die fehlende `DEEP_OBD_DTC_TEXTS`-Tabelle aus echter Firmware (4407/17xx→Klartext-Heuristik), statt SGBD zu suchen.
2. **paceworx-store/EDC15C13-Checksum-Correction + mtx-electronics/vag-checksum-fix** – Checksum-Modelle gegen `src/lib/kwp/checksum.ts` differ-testen; C13-Corrector könnte C4-Blocklayout (0x013FFC–0x013FFF + Dateiende, Task 7-Befund) bestätigen.
3. **SchoepsLabs/webserial-android** in die Android-Installations-Anleitung (Tuning-Wissen-Tab) aufnehmen als Plan B für Geräte ohne Chrome 148 (oder MagicOS-Browser ohne Serial).
4. **LeZed97/ZedSuite** – Kennfeld-Editor-Ansatz für den geplanten „Kennfeld-Raster-Viewer“ (Worklog Task 7: nächste Schritte) studieren; 100 %-lokale Auto-Detection ist das richtige UX-Muster.
5. **muki01/OBD2_K-line_Reader** – README-Toolbox-Eintrag „Android/K-Line-Hardware“ + Referenz für 5-Baud-Timing-Puffer (3 Erwähnungen von Slow-Init-Timing-Problemen in Issues, q3-Suche: OBD9141 Issue #41, nefariousmotorsports-Thread).

### 3 technische Fakten zu Web Serial / Android / OTG (mit Quellen)

1. **Chrome für Android: Web Serial kam in 138, aber NUR teilweise (Bluetooth-RFCOMM), vollständig erst ab 148.** MDN browser-compat-data (api/Serial.json, Rohdaten verifiziert): `chrome_android = [{148}, {138 … 147, partial_implementation: „Serial ports are only available if they're provided by Bluetooth RFCOMM serial port emulation.“}]` – d. h. USB/OTG-K-Line-Adapter funktionieren auf Android erst ab Chrome 148; in 138–147 nur BT-SPP. Quelle: https://github.com/mdn/browser-compat-data (api/Serial.json) / https://developer.mozilla.org/en-US/docs/Web/API/Serial_API ; Artikel zur 148-Beta: https://www.notebookcheck.net („Chrome 148 Beta for Android adds Web Serial“, 2026-04).
2. **Android WebView erhält Web Serial GAR NICHT; verkabelte Ports laufen über die Android-Serial-API und kommen laut Chromium-PSA ab 2026 Q2 nur auf „a limited set of devices“.** Quelle: MDN BCD `webview_android: false` (https://developer.mozilla.org/en-US/docs/Web/API/Serial_API) + Chromium blink-dev-PSA: https://groups.google.com/a/chromium.org/g/blink-dev/c/yGhvQ6mEmcY/m/xr-aYJ-_AQAJ → QFLASH21s TWA-Ansatz (v1.2.0, Chrome-Engine statt WebView) ist damit die korrekte Architektur; Custom-Tab-Fallback ebenfalls Chrome-basiert.
3. **Vor 148 ist der bekannte Workaround WebUSB-Polyfill mit harten Limitierungen (nur explizite VID/PID-Filter, keine Serien-Daten-Abstraktion) – dokumentierte OTG-Stolpersteine: Port muss VOR/ohne angeschlossenem OTG-Kabel initialisiert werden, und manche Serial-Ports liefern auf Android fehlerhafte Daten (Qualcomm-EDL-Fall).** Quellen: https://developer.chrome.com/docs/capabilities/serial („On Android, support for USB-based serial ports is possible using the WebUSB API and the Serial API polyfill. This polyfill is limited to …“), https://community.appinventor.mit.edu („Serial OTG Port does not open Serial Port“, Init-Reihenfolge-Quirk), https://github.com/… („webserial return wrong data but other methods works fine“, Qualcomm 0x9008). Hinweis für QFLASH21: CH340/FTDI-Adapter (VID/PID 1a86:7523 / 0403:6001) für einen künftigen WebUSB-Fallback fest im Code hinterlegen.

### SDK-/Methodik-Notiz
Die z-ai web_search-Funktion drosselt parallel ab ~3 gleichzeitigen Aufrufen (HTTP 429) – nachfolgende Batches wurden sequenziell mit 3 s Abstand ausgeführt. Zwischenergebnisse: /tmp/qf9a/search/ (q1–q8.json, gh_*.json, bcd.json, caniuse.json).

## Offene Lücken
- DDE4-DTC-Klartexte weiterhin ungelöst (SGBD nötig) → Heuristik-Idee siehe Empfehlung 1.
- Kein verifizierter EDC15**C4**-Checksum-Corrector öffentlich.
- Chrome-148-Geräteverbreitung (MagicOS/Honor!) unbekannt → Nutzer-Test nötig (welcher Chrome-Build auf dem Honor Magic Pro 8).
- EDC15-„pinout/tools“-Suche lieferte nur Foren-/Video-Treffer (ecuconnections-Thread „BMW EDC15C4 project“ ist lesenswert, aber kein Repo).
