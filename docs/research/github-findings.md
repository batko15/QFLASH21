# GitHub Deep-Search EDC15C4 / BMW DDE4.0 — Task 7-a

**Agent:** general-purpose (Research) · **Datum:** 2026-02 · **Budget:** 13 Web-/API-Calls (Budget 12, +1 wegen Tarball-Effizienz; 3 Calls entfielen auf Fehlversuche: contents-API-Fehler, 2× raw-404 auf falschem Branch)

**Methodik:** GitHub Repo-Search API (ohne Token) mit `q=EDC15C4`, `q=EDC15`, `q=DeepOBD`, `q=DDE4 BMW` → 3 relevante Repos als Tarball komplett geladen und lokal ausgewertet (Binär-Diffs, PDF-Textextraktion, XSD-Analyse).

**Gefundene Repos (Relevanz-Ranking):**

| Repo | Relevanz | Inhalt |
|---|---|---|
| GabrielStanescu/BMW_M57_EDC15C4 | ★★★ | **Bosch EDC 15C Funktionsbeschreibung B079.CC0 (PDF, offizielles Bosch-Dokument, BMW Y 445 S00 003, 2001)** + WinOLS-Projekte (damos/remap .ols) + Original-Flash BMW 330d 184PS (SW 1037351761) |
| Mursteinen/BMW-DDE4-EDC15c4-EcuID | ★★★ | 23 Original-Flash-Dumps EDC15C4 (BMW 4.0D, Mini 1.4d, Rover 75 CDTI, Freelander 2.0) + 2 IMMO-off-Patchdateien (Boot-Read) |
| Dekon01/DeepObdE46Config | ★★ | Deep OBD for BMW (holeschak) Konfig-Format: `BmwDeepObd.xsd`, `.ccpage`/`.ccpages`/`.cccfg`-Beispiele (MS43/IHKA/ZKE, kein Diesel-ECU) |
| kmalinich/deepobd-configs | ★ | DeepOBD XML-Beispielkonfigurationen |
| muki01/Bosch_EDC15_EEPROM_Tool, NickTullos/edc15vm-flash-editor, krook1024/edcp | ★ | EDC15-VAG-Tools (24C04-IMMO, DTC-Discovery in Binaries) – nicht BMW-spezifisch, nur als Folgequellen |

**WICHTIG (Copyright):** Das Bosch-PDF ist urheberrechtlich geschützt („© Robert Bosch AG“). Zitate hier nur als kurze Auszüge für interne Forschungszwecke; PDF via GitHub-Link selbst beziehen.

**Primärquelle (fast alle Abschnitte):**
`https://github.com/GabrielStanescu/BMW_M57_EDC15C4` → Datei `Bosch EDC 15C Funktionsbeschreibung.pdf` (EDC15C B079.CC0, Kap. 10 = Diagnose/KWP2000, Anhang A = Fehlerbehandlung). Volltext lokal extrahiert (`/tmp/edc15c_full.txt`, 62k Zeilen, ephemeral).

---

## A. EDC15C4-Fehlercode-Tabelle (17xxx/5-stellig → Klartext)

**Konkrete 5-stellige DTC-Tabelle mit Klartext: NICHT GEFUNDEN.** Weder die Repo-Suche noch das Bosch-PDF enthält eine numerische Zuordnung (17xxx → Text). Die Fehlertexte liegen bei Bosch in den SGBD/Labels-Dateien, die nicht auf GitHub auffindbar waren. → QFLASH21-Bestand (51 Codes) bleibt aktuell größte bekannte Quelle.

**Gefunden: Codestruktur + Fehlerspeicher-Innenaufbau (erweitert DTC-Parsing/Analyse):**

1. **SAE-J2012-Struktur** (PDF Kap. 10.1.3.6, S. 10-68f): 2 Bytes; oberes Nibble = Bereich, 3 BCD-Nibbles = Code. Gruppen: `00`=P, `01`=C, `10`=B, `11`=U.

2. **Fehlerspeicher-Eintrag (28 Bytes, max. 10 Einträge + Freeze Frame)** — PDF Kap. 8.5.2.4, S. 8-33:

| Byte | Bedeutung |
|---|---|
| 0 | Pfadnummer des Fehlerpfades |
| 1 | Statusbits (Fehlerart high): Bit0=abgasrelevant, Bit1=Blinkfehler, Bit2=**Fehler aktuell**, Bit3=sporadisch (Häufigkeitszähler>1), Bit4=nicht selbstlöschend, Bit5=mit Umweltblock1 entprellt gespeichert, Bit6=MIL-entprellt, Bit7=mit 2. Umweltblock gespeichert |
| 2 | Fehlerart aktuell (letzte aufgetretene) |
| 3 | Entprellzähler |
| 4 | Logistik-Zähler (Heilung, zählt _HLC→0) |
| 5 | Zähler für Fehlerlöschung (Shadow-FSP) |
| 6 | Häufigkeitszähler (max. 255) |
| 7–11 | Fehlerart-low + Umweltbedingungen 1–4 (Block 1) |
| 12–13 | KM-Stand / Betriebsstunden bei Umwelteintrag Block 1 (high/low) |
| 14–18 | Fehlerart-low + Umweltbedingungen 1–4 (Block 2) |
| 19–20 | KM-Stand / Betriebsstunden bei Umwelteintrag Block 2 (high/low) |
| 21–27 | (weitere Verwaltungsbytes/Umwelt) |

3. **EWS-Fehler (aus Fehlerbehandlungstabelle fboSEWS)** — PDF S. A-8/A-54ff, inkl. Index + Bitmaske (so sehen die Bytes im Fehlerspeicher aus):

| fb-Name | Klartext (DE) | Index | Bit |
|---|---|---|---|
| fbeEEWS_M | EWS Manipulationsversuch | 0 | 01H |
| fbeEEWS_P | EWS Übertragungsfehler | 1 | 02H |
| fbeEEWS_T | EWS Timeout abgelaufen | 2 | 04H |
| fbeEEWS_U | EWS UC im EEPROM defekt | 3 | 08H |
| fbeEEWS_W | EWS WC im EEPROM defekt | 4 | 10H |

*Quelle: GabrielStanescu/BMW_M57_EDC15C4 (Bosch PDF). Konfidenz: hoch (Struktur/Aufbau), — (DTC-Nrn. nicht gefunden).*

**Folgequellen für spätere DTC-Tabellenerweiterung (nicht verifiziert):** NickTullos/edc15vm-flash-editor (DTC-Discovery-Heuristik in EDC15-Binaries, VAG), EDS-/SGBD-Sammlungen außerhalb GitHub.

---

## B. Live-Block-Layouts EDC15C4 (0x03/0x07/0x13/0x15/0x17)

**Konkretes Byte→Messwert/Faktor/Einheit-Layout: NICHT GEFUNDEN.** Diese MWB-Zuordnung steckt in den DDE4-SGBD (Ediabas), die auf GitHub nicht auffindbar waren. DeepOBD-Beispiele (Dekon01) sind Benziner (MS43).

**Gefunden: der dokumentierte Lesemechanismus im Bosch-Dokument** (wichtig als zweite Datenquelle neben McMess/STATUS_MESSWERTEBLOCK):

- Service `readDataByLocalIdentifier` (0x21) mit `recordLocalIdentifier` **0x20–0x2F = 16 Blöcke à 10 Messwerte** (Labels `xcwD20_E1 … xcwD2F_E10`, „frei applizierbar“ = SW-variantenspezifisch).
- Request: `B8 12 F1 02 21 <LID> CS` · Response: `B8 F1 12 <len> 61 <LID> <Val#1 hi> <lo> … <Val#10 hi> <lo> CS`
- Abbruchverhalten: Bei undefinierter Message-Nummer im Block antwortet das SG nur bis zu dieser Position und beendet das Telegramm direkt mit der Checksumme (→ einfach detektierbare Blocklänge).
- „Meßwerte lesen dynamisch“: Service 10.1.2.16 `DynamicallyDefinedLocalIdentifier` (S. 10-25).

| Item | Wert | Quelle | Konfidenz |
|---|---|---|---|
| LID-Bereich statische Messwerte | 0x20–0x2F (Block 0–15), je 10 Wörter | Bosch PDF Kap. 10.1.2.8, Tab. 10-3 (S. 10-16f) | hoch |
| Request-/Response-Frame | s. o. (FMT=B8, TGT=0x12, SRC=0xF1) | Bosch PDF | hoch |
| Konkrete Zuordnung Byte→Messwert | — | nicht gefunden | — |

**DeepOBD-Template fürs UI (Struktur, MS43-Beispiel):** `MS430DS0.ccpage` zeigt Aufbau `<page>/<strings>/<job name="STATUS_MESSWERTEBLOCK" …>/<display …>` mit RESULTS wie `STAT_MOTORDREHZAHL_MWB_WERT` (Drehzahl), `STAT_GESCHWINDIGKEIT_MWB_WERT` (km/h), `STAT_LMM_MASSE_MWB_WERT` (kg/h), `STAT_MOTORTEMP_MWB_WERT` (°C) u. a. — Muster für QFLASH21-Live-Panel übertragbar.
*Quelle: Dekon01/DeepObdE46Config `MS430DS0.ccpage`. Konfidenz: hoch (Format), — (kein EDC15C4-Inhalt).*

---

## C. EWS-Delete / ISN-Patch für EDC15C4

### C1. KWP2000-Routine „EWS-Startwertinitialisierung“ (DDE4.0) — DIREKT NUTZBAR

**Quelle: Bosch PDF Kap. 10.1.2.30 (S. 10-51) + 10.1.2.7 (S. 10-15). Konfidenz: hoch** (offizielles Bosch-Dokument, explizit „Alle Services werden sowohl von der DDE4.0 als auch der DDE4.1 unterstützt“).

Startroutine (Service 0x31 = StartRoutineByLocalIdentifier, RLI **0x83**):

```
Request:   B8 12 F1 03 31 83 <REYO> CS
  REYO (RoutineEntryOption): 00 = jungfräuliches SG programmieren
                             01 = gebrauchtes SG rücksetzen
                           (laut DS2-Lastenheft)

Response:  B8 F1 12 03 71 83 <Verifybyte> CS
  Verifybyte: 00 = DDE bereit
              01 = Startwert schon gespeichert
              02 = noch kein Startwert
              03 = Urcode zerstört

Negative Response: 7F 31 mit RC: 10 = Startwertinitialisierung noch nicht ausgeführt /
  SG-Rücksetzen in diesem Fahrzyklus nicht ausgeführt, 11 = Service nicht vorhanden,
  12 = unplausible Anforderung, 21 = busy-repeatRequest
```

EWS-Status danach abfragen via RDBLI, RLI **0x06**: `B8 12 F1 02 21 06 CS` → `B8 F1 12 <len> 61 06 <Status> CS`.

### C2. EWS-Innenlogik (fb-Schlüssel + EEPROM-Variablen)

**Quelle: Bosch PDF A.2.49 „Elektronische Wegfahrsperre (fboSEWS)“ (S. A-54ff). Konfidenz: hoch.**

- EEPROM: `xcmZF_S` = Urcode (speichert Vergleichs-Urcode), empfangen `xcmZF_EE`; Zufallszahl `xcmZ_F`, letzte Zufallszahl beim Rücksetzen `xcwEWSZ_Fi`, Maxwert `xcwEWSZ_F`; Übertragungsfehlerzähler `xcmZ_E`/Schwelle `xcwEWSZ_E`; Timeout `xcwEWSTMAX`.
- Fangbereich für gültigen Wechselcode: **200 Codes**; Falschcodezähler inkrementiert/dekrementiert um `xcmEWSZ_Fi`.
- Heilung: `fbeEEWS_M/P/T/W` per EWS-Startwertinitialisierung heilbar; **`fbeEEWS_U` (Urcode im EEPROM zerstört) NICHT heilbar → Recyclingfall**. Nach Heilung bleibt Mengenausgabe bis Ende der Nachlaufphase gesperrt.
- Vollständige Challenge-/Response-Codetabelle der EWS: **separates Bosch-Dokument „Anhang Wegfahrsperre“ — auf GitHub NICHT gefunden.**

### C3. IMMO-off Byte-Patterns aus realen EDC15C4-Boot-Reads (Binär-Diff, selbst verifiziert)

**Quelle: Mursteinen/BMW-DDE4-EDC15c4-EcuID, `PatchedFiles/` vs `Original files/` (je 512 KB = 29F400). Konfidenz: mittel** — Methode geprüft (echte Diffs), aber SW-variantenspezifisch (Rover 75 CDTI / Freelander 2.0, nicht BMW M57) und Semantik nicht dokumentiert. **Nicht blind anwenden!**

Diff 351065 (Rover 75 CDTI):

| Offset | ori → patch | Interpretation (Vermutung) |
|---|---|---|
| 0x0122DE, 0x0123DC, 0x012428, 0x012AAA, 0x07E76A | `2D → 0D` | wiederkehrende Konstante/Opcode-Änderung (DTC-/Immo-Reaktion), 5× |
| 0x0300EF, 0x030164, 0x030945 | `8E → 8F` (einmal `9C → 8F`) | Inkrement auf 0x8F |
| 0x030424–0x030425 und 0x0311BA–0x0311BB | `A3 C4 → 01 00` | **2-Byte-Flag → 0x0001 (LE) an 2 Stellen — Immo-Kandidat** |
| 0x013FFC–0x013FFF | `58 F3 08 59 → 8F 6D 4C DC` | Checksumme Block 0x00000–0x13FFF |
| 0x07EBFC–0x07EBFF | `86 38 D5 CC → F1 0B C5 60` | Checksumme Blockende (Dateiende) |

Diff 361846 (Freelander 2.0): gleiche Musterstruktur — Flags → `01 00` bei **0x0371C4–C5** und **0x037F5A–5B**; Checksummen 0x013FFC–FFF und 0x07F953–54; `2D→0D` 4×; Zusatzänderungen im Ident-/Serialbereich 0x07F905–0x07F954 (vermutlich durch Boot-Read vs. Datei-Herkunft).

→ **Methode:** Offset der Immo-Flags ist SW-spezifisch; Auffindprinzip: Suche nach 2 Stellen mit Word-Flag kurz vor/neben `8E/9C→8F`-Inkrementen + Neuberechnung der Block-Checksummen (0x013FFC, Dateiende). Für BMW M57-SWs (351086/351734 etc., liegen im selben Repo) müsste man Referenz-Immo-off-Files beschaffen oder die Flags per Code-Analyse lokalisieren.

### C4. EEPROM-Tools (nur VAG-EDC15, als Richtungshinweis)

`muki01/Bosch_EDC15_EEPROM_Tool` (24C04: IMMO-Status, Login-Codes) und `RJ-6463/Bosch_EDC15_EEPROM_Tool` — VAG-spezifisch, **kein** EDC15C4/95040-ISN-Pattern gefunden.

---

## D. DeepOBD PRG/ccpage-Format

**PRG-Dateien: nicht gefunden. ccpage-Format: gefunden (vollständiges XSD + Beispiele).**

**Quelle: Dekon01/DeepObdE46Config. Konfidenz: hoch (Formatdefinition), mittel (Anwendbarkeit auf DDE4).**

- Namespace: `http://www.holeschak.de/BmwDeepObd`, Schema `BmwDeepObd.xsd` (21.6 KB).
- Dateitypen: `.cccfg` = App-Konfiguration (`App_BT.cccfg`, `App_USB.cccfg` — Interface/Log-Pfad), `.ccpages` = Seitenindex (`Pages.ccpages`, `<pages><include filename=…>`), `.ccpage` = Einzelseite (`<fragment>` mit `<page name=…>`, `<strings>` (Mehrsprachigkeit via `name`/`lang`-Attribute), `<job>` (Attribute: `name, sgbd, results, args_first, args, mwtab, mwdata, show_warnigs`), `<display>` (Attribute: `format, grid-type, min-value, max-value, log_tag, weight, display-mode, fontsize`), `<read_errors>` mit `<ecu name=… sgbd=… results=…>` (F_ANZ_NR;F_ORT_NR;F_ORT_TEXT;F_ART_ANZ;F_ART1_NR;…)).
- Jobs referenzieren Ediabas-SGBDs (`sgbd="MS430DS0"` etc.) — d. h. **DDE4-Unterstützung bräuchte ein DDE4-SGBD**; die ccpage-Schale wäre direkt wiederverwendbar.
- Zweites Beispiel: `kmalinich/deepobd-configs` (XML-Konfigs, generisch). Ein EDC15C4/DDE4-ccpage oder ein PRG-File war **nicht auffindbar**.

---

## E. 5-Baud-Init-Adresse + Keyword-Bytes DDE4.0

**Quelle: Bosch PDF Kap. 10.1.3 (S. 10-60 ff.) + Tab. 10-1 (S. 10-6). Konfidenz: hoch (Dokument), mittel (Soll-Verifikation gegen echte K-Line-Logs empfohlen).**

**Physikalische Steuergeräteadressen (Tab. 10-1):**

| Projekt | SG-Adresse |
|---|---|
| **DDE4.0** | **0x12** ✔ (bestätigt QFLASH21-Annahme) |
| DDE4.1 (Master) | 0x12 |
| DDE4.1 (Slave) | 0x13 |

**5-Baud-Reizung:** 1 Startbit (log. 0) · 7 Datenbits LSB-first · 1 Paritätsbit · 1 Stopbit (log. 1).

| Adresswort | Bedeutung | Parität |
|---|---|---|
| 0x33 | funktional: OBD II-abgasrelevantes System | gerade |
| 0x7D | funktional: Fahrberechtigungssystem | gerade |
| **0x12** | physikalisch: DDE4.0 | **ungerade** |

**Kommunikationsaufbau nach Reizung (Abbildung XCKW02):**

1. SG → TG: Synchronmuster **0x55** (8N1)
2. SG → TG: Keywords (7 Datenbits/ungerade Parität): **KW1 = 0x6B, KW2 = 0x8F**
3. TG → SG: invertiertes 2. Keyword (**~0x8F = 0x70**)
4. SG → TG: invertierte Initialisierungsadresse (**~0x12 = 0xED**)
5. Danach Datenkommunikation mit **10400 Baud** fest verankert (Abbruch der Reizung bei gestörtem Start-/Datenbit, unbekannter Adresse oder ungültigem Stopbit; danach Rückkehr in Reizungserkennung nach Zeit T0)

**Komplementärfunde:**
- Frame-Format KWP2000: `FMT(Typ) TGT SRC LEN [SID/Daten] CS`; Tester-Source-Adresse = **0xF1**; alle Request-Beispiele im Dokument: `B8 12 F1 …`.
- `StartDiagnosticSession` (0x10) mit BaudrateIdentifier: Umschalten der Baudrate möglich; Standard-KWP2000-Mode nach Stop/Reset = **9,6 kBaud** (Kap. 10.1.2.1).
- Zeitdefinitionen (T0–T4, P2/P3/P6): Kap. 10.1.3.3, S. 10-66 (im PDF-Text als Tabelle, Werte liegen im Original-PDF).
- **ECU-ID aus Flash:** SW-Nummer steht als 6-Byte-ASCII bei Offset **0x7BFB4** ( terminiert mit 0xC3) — per Python über 4 Dumps (BMW 4.0D 351086, 351734, Rover 351065, Freelander 361846) verifiziert: exakt „351065“, „351734“, „351086“, „361846“. *Quelle: Mursteinen/EcuID `main.py` + eigene Verifikation. Konfidenz: hoch (Boot-Read-Layout 512 KB).*
- Alternativprotokoll **McMess** (Kap. 10.2): 9-Datenbit-Asynchron auf K-Leitung, optimiert für schnelles RAM-Auslesen — Option für performantes Live-Streaming.

---

## Top-3-Quellen

1. **Bosch „Funktionsbeschreibung EDC15C B079.CC0“** — https://github.com/GabrielStanescu/BMW_M57_EDC15C4 (offizielles Bosch-Dokument; füllt B-Mechanik, C1/C2, E fast komplett)
2. **Mursteinen/BMW-DDE4-EDC15c4-EcuID** — https://github.com/Mursteinen/BMW-DDE4-EDC15c4-EcuID (23 echte EDC15C4-Dumps BMW/Land Rover, SW-Offset 0x7BFB4, 2 verifizierte IMMO-off-Diffs)
3. **Dekon01/DeepObdE46Config** — https://github.com/Dekon01/DeepObdE46Config (vollständiges BmwDeepObd.xsd + ccpage/cccfg/ccpages-Beispiele = Deep-OBD-Format für Abschnitt D)

## Offene Folgeaktionen (für nächste Tasks)

1. **Keywords verifizieren:** echte Init-Logs (KW 6B/8F?) mit QFLASH21-Mitschnitt abgleichen; ggf. DDE4.1-Variante prüfen.
2. **EWS-Routine 0x83** in QFLASH21 als Funktion („EWS zurücksetzen/programmieren“) mit Verifybyte-Auswertung implementieren (C1) — Achtung rechtliche/funktionale Risiken, nur mit Eigentümerversion.
3. **Block-Layouts 0x03/0x07/0x13/0x15/0x17:** nicht via GitHub auffindbar → SGBD-Beschaffung (Ediabas-DDE4.psg/.prg-Sammlungen) oder empirisch per LID 0x20–0x2F Scan + McMess.
4. **DTC-Tabellenerweiterung:** Bosch-Fehlernummern (17xxx) stecken in SGBD/Labels; Kandidaten: EDS-Materialien außerhalb GitHub, NickTullos-DTC-Heuristik als Cross-Check gegen vorhandene Binaries.
5. Bosch-PDF komplett lokal sichern und Kap. 8.5 (Fehlerspeicher), 10.1.3.3 (Timings) für QFLASH21-Doku extrahieren.
