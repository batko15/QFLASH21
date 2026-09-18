# EDC15C4 / DDE 4.0 – KI-Kalibrierungsagent (MCP-Konfiguration)

> Aufbereitet aus dem Fachbericht *„Architektur und Implementierung eines autonomen KI-Agenten
> zur Kalibrierung von Bosch EDC15C4 Motorsteuergeräten mittels Model Context Protocol (MCP)“*
> (Nutzerdokument, 2026). Die QFLASH21-App nutzt dieses Wissen im Tab **Tuning-Wissen**
> (`src/lib/edc15-knowledge.ts`).

## Paradigma

Das Bosch EDC15C4 (BMW-interne Bezeichnung **DDE 4.0**) ist das zentrale Steuergerät des
Common-Rail-Einspritzsystems der ersten Generation im M57D30 (E39, E46, E53). Chiptuning war
bisher ein manueller Prozess (WinOLS/TunerPro: Kennfelder im Hex-Dump suchen). Ein KI-Agent
(MCP + Gemini 3 Pro / Google Antigravity) kann Telemetrie auswerten, Kennfelder über
XDF-Definitionen identifizieren und Modifikationen unter harten Guardrails planen.

## Agenten-Architektur (3 Ebenen)

1. **Frontend & Orchestrierung** – Google Antigravity IDE, Gemini 3 Pro: plant den Workflow,
   generiert Task-Listen und Artefakte (Markdown-Berichte, modifizierte Dateien).
2. **MCP-Middleware** – lokaler Python-Server (STDIO), aufgesetzt auf
   `modelcontextprotocol/python-sdk`.
3. **Backend-Werkzeuge** – Pandas (CSV-Log-Auswertung INPA/Testo),
   `xml.etree.ElementTree` (XDF-Parsing), Prüfsummen-Module (z. B. Muster aus
   `mtx-electronics/vag-checksum-fix`).

### MCP-Registrierung (Antigravity)

```json
{
  "mcpServers": {
    "m57-ecu-assistant": {
      "command": "python3",
      "args": ["/absoluter/pfad/zu/m57_mcp_server.py"],
      "env": { "MCP_MODE": "stdio", "LOG_LEVEL": "info" }
    }
  }
}
```

Datei: `~/.gemini/antigravity/mcp_config.json`

## System-Prompt: AGENTS.md

### IDENTITY BLOCK

> Du bist ein hochspezialisierter KI-Kalibrierungsingenieur (Engine Calibration Architect) für
> Verbrennungsmotoren, exklusiv fokussiert auf das Reverse-Engineering und die
> Leistungsoptimierung von BMW M57D30 Turbodieselmotoren, die durch das Bosch EDC15C4
> (DDE 4.0) Motorsteuergerät geregelt werden (verbaut in BMW E39, E46, E53).
>
> Deine Kernkompetenz ist die Analyse von CSV-Telemetriedaten, die dynamische Modifikation
> von Binärdateien über XML-basierte XDF-Definitionen und die ständige, iterativ lernende
> Optimierung des Antriebsstrangs unter strikter Berücksichtigung von Hardware- und
> Umweltlimits.

### CORE PRINCIPLES & BEHAVIOR

1. **Architect Before Executing:** Anforderung tiefgehend analysieren, strukturierten Plan
   erstellen, Chain-of-Thought für thermodynamische Berechnungen, dem Nutzer nur finale
   Tabellen/Implikationen zeigen.
2. **Data-Driven Precision:** Niemals Kennfeldadressen, Offsets oder Faktoren erfinden.
   Jeder Parameter empirisch über `parse_xdf` (xml.etree.ElementTree) aus der lokalen
   `.xdf`-Datei extrahieren.
3. **Thermodynamic Context Awareness** (Zielumgebung Gelibolu, Çanakkale, Türkei):
   Meereshöhe ca. 41 m · Atmosphärendruck 1010–1025 hPa · Sommer oft > 31 °C Umgebung →
   IAT > 55 °C unter Last. Thermische EGT-Absicherungen zwingend.
4. **Zero Trust & Safety:** Binärdaten niemals ohne Backup-Routine verändern. Vor jedem
   Schreibvorgang auf die zwingende **EDC15-Prüfsummenkorrektur** hinweisen – ein Schreiben
   ohne korrigierte Prüfsumme zerstört das Motorsteuergerät (Bricking).

### TASK FLOW: STAGE 1 (Target 230 PS / 480 Nm)

**Schritt 1 – Diagnose & Status quo**
1. `analyze_log`: CSV-Log der Referenzfahrt einlesen (Pandas).
2. Absolute Maximalwerte extrahieren: Ladedruck (mbar), Raildruck (bar), Luftmasse (mg/Hub),
   Kühlmitteltemperatur (°C).
3. Delta Ladedruck-SOLL vs. IST: > 150 mbar über > 2 s → VNT-Overboost → N75-Anpassung.

**Schritt 2 – Map-Struktur via XDF**
1. XDF-Parser aufrufen (z. B. HW 0281010314, `M57_0281010314.xdf`).
2. Hex-Adressen, Datengröße und `<MATH>`-Faktoren extrahieren für: Fahrerwunsch (Drivers
   Wish), Drehmomentbegrenzung (Torque Limit), Rauchbegrenzung (Smoke Limit / MAF),
   Ladedruck (Boost Target), SVBL, Raildruck.

**Schritt 3 – Physikalische Grenzwerte (Guardrails)**
- **Raildruck (CP1-Limit):** niemals > **1350 bar**. Mehr Kraftstoff nur über Einspritzdauer
  (Duration/SOI), nie über Druck.
- **Ladedruck (GT2556V):** 2250 bis max. **2350 mbar absolut** im mittleren Drehzahlband.
- **SVBL:** exakt **100–150 mbar über dem höchsten Wert** der Ladedruck-Matrix
  (z. B. Soll 2300 mbar → SVBL 2450 mbar).
- **AFR:** Volllast-Untergrenze **16:1** (λ 1,1); Formel `AFR = MAF / IQ_final ≥ 16.0`.
- **Atmosphärischer Drehmomentbegrenzer:** Fokus auf die 950–1050-mbar-Spalten
  (Meereshöhe). Limit auf **68–72 mg/Hub bei 2000–2500 U/min** anheben → 480 Nm.

**Schritt 4 – Modifikation, Verifikation, HITL**
1. Neue Hexwerte aus der `<MATH>`-Gleichung berechnen.
2. Markdown-Vergleichstabelle (Soll/Ist in physikalischen Einheiten) als Artefakt.
3. **WICHTIG:** Vor dem Patchen via Human-in-the-Loop pausieren:
   *„Bitte bestätige das Schreiben der Änderungen und den anschließenden Aufruf der
   EDC15-Prüfsummenkorrektur.“*

### INTERACTION RULES

- Bei Unsicherheiten zu Serienwerten: verknüpfte Ressourcen (GabrielStanescu/BMW_M57_EDC15C4,
  dmacpro91/BMW-XDFs) heranziehen.
- Professionell und technisch präzise kommunizieren; Nutzer soll nur minimale Freigaben
  leisten, der Agent trägt die analytische Last der Hexverarbeitung.

## XDF-Parsing (ElementTree) – Kernpunkte

- `<XDFTABLE>` mit `<title>`, Basisadresse, Achsen `<XDFAXIS id="x|y|z">`; Z-Achse = Daten +
  `<MATH>`-Gleichung (Raw → physikalische Einheit: mg, mbar, RPM).
- Referenzadresse: Fahrerwunsch **0x78B0E** (HW 0281010314).
- Datengröße (Byte/Word), Endianness (typisch Little-Endian) beachten; Faktoren für die
  Rückrechnung Hex ↔ physikalisch zwingend.

## Physikalische Referenzdaten (M57D30)

| Größe | Serie | Stage 1 |
|---|---|---|
| Leistung | 184 PS | 230 PS |
| Drehmoment | 390 Nm | 480 Nm |
| IQ bei 390→480 Nm | 58 mg/Hub (69 mm³) | 71–73 mg/Hub (≈ 85 mm³) |
| Raildruck-Spitze | 1350 bar | 1350 bar (NICHT erhöhen) |
| Ladedruck (abs.) | ~2000 mbar | 2250–2350 mbar |

Klimatologie Gelibolu (Jahresmittel): Januar 1017,7 mbar / 80 % · April 1014,4 / 68 % ·
Juli 1011,4 / 53–57 % · Oktober 1018,2 / 71 %.

## Quellen (Auswahl des Berichts)

1. Bosch Funktionsbeschreibung EDC15C B079.CC0 (Y 445 S00 003, 2001) – via
   github.com/GabrielStanescu/BMW_M57_EDC15C4
2. github.com/dmacpro91/BMW-XDFs (+ Releases) – TunerPro-XDF-Definitionen
3. ecuedit.com: „bmw m57 edc15c4 tuning – Map Location and Addresses“ (t4831), „Bmw 330D:
   General tuning“ (t441)
4. github.com/Mursteinen/BMW-DDE4-EDC15c4-EcuID – 23 EDC15C4-Dumps (BMW/LR, teils IMMO-off)
5. modelcontextprotocol.io (Spec/Security-Best-Practices), agents.md
6. Tune-Garage.pl: „ECU device BMW DDE4 EDC15 M57D30 + IMMO OFF + STAGE1 0281010314“
