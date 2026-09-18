# QFLASH21

**Lokales Diagnose- und Flash-Tool für BMW DDE4 (EDC15C4) über K-Line / KWP2000 – direkt im Browser.**

QFLASH21 ist eine Installierbare Web-App (PWA) zur Kommunikation mit der Motorsteuerung
**DDE4** der Modelle:

| Baureihe | Modelle |
|---|---|
| E38 | 730d |
| E39 | 525d / 530d |
| E46 | 330d / 330xd |
| E53 | X5 3.0d |

## Funktionen

- **ECU-Identifikation** – 5-Baud-Init + KWP2000-Ident, DDE4.0-Erkennung über Schlüsselwörter (0x45 0x05)
- **Fehlerspeicher** – normaler Speicher (0x18 FF00) **und** Schattenspeicher (0x18 FD00) lesen, löschen (0x14), KI-Werkstattanalyse
- **Live-Daten** – 4 Messwertblöcke (Drehzahl, Temperatur, Einspritzmenge, Ladedruck …) mit 600-ms-Polling
- **Flash lesen** – FULL (512 KiB) und CAL (48 KiB) über 0x35/0x36, Download als BIN
- **Prüfsummen** – Bosch-CR2-Verifikation (16-KiB-Bänke, 2×16-Bit-Summenwörter) mit automatischer Korrektur
- **BIN-Verwaltung** – Upload, Diff-Vergleich, Hex-Dump, Download
- **Protokoll** – vollständiges Kommunikationslog, Export als OperationLog

## Android-Nutzung (Honor Magic Pro 8 & andere)

QFLASH21 läuft **direkt auf Android** über Chrome (≥ **138**) und einen USB-C-OTG-Adapter:

1. **OTG-Adapter** (USB-C → USB-A) ans Handy, dann das **K+DCAN-Kabel** (FTDI FT232RL, `0403:6001`) einstecken
2. Diese Seite in **Chrome** öffnen (HTTPS erforderlich) und ggf. über **„App installieren“** als PWA auf den Startbildschirm legen
3. **Zündung einschalten** (Stellung 2), im Tab *Verbindung* auf **„Verbinden (echter Adapter)“** tippen
4. Adapter im Browser-Dialog auswählen – das 5-Baud-Init dauert ca. 2 Sekunden (Bildschirm anlassen!)

> ⚠️ Web Serial benötigt **HTTPS** und einen **Chrome-Browser**. Firefox und Safari (iOS) werden nicht unterstützt.
> Bevorzugte Kabel: FTDI FT232RL- oder ST232-Chipsätze. Bei Empfangsproblemen Baudrate auf 38400 (SLOW WRITE) stellen.

### Unterstützte Adapter

| Chipsatz | USB-ID | Status |
|---|---|---|
| FTDI FT232RL | `0403:6001` | empfohlen |
| CH340/CH341 | `1A86:7523` | unterstützt |
| CP2102 | `10C4:EA60` | unterstützt |

## Desktop-Nutzung

Chrome oder Edge ≥ 89 (Windows/macOS/Linux) mit USB-A→USB-K-Line-Adapter.

## Entwicklung

```bash
bun install          # Dependencies
bun run db:push      # Prisma-Schema (SQLite) anlegen
bun run dev          # Dev-Server auf Port 3000
bun run lint         # ESLint (0-Warnungen-Politik)
```

### Architektur

```
src/
├── app/
│   ├── page.tsx              # Haupt-App (8 Tabs)
│   └── api/
│       ├── logs/             # OperationLog (Prisma, SQLite)
│       └── analyze-dtc/      # KI-Fehleranalyse (LLM, mit Offline-Fallback)
├── components/qf/            # UI (Tabs, Panels, PWA)
├── lib/kwp/
│   ├── serial-client.ts      # Web Serial: 5-Baud-Init über BREAK, Echo-Handling
│   ├── protocol.ts           # ISO 14230 Framing + NRC-Tabelle
│   ├── dde4.ts               # DDE4-Profil (Services, DTC-Tabelle, Security-Access)
│   ├── checksum.ts           # Bosch-CR2-Prüfsummen
│   ├── bin.ts                # FULL/CAL-Erkennung, Diff, Hex-Dump
│   └── mock.ts               # Virtuelles DDE4 (Simulator, ohne Fahrzeug testbar)
└── store/flasher.ts          # Zustand: Verbindungs-/Flash-Statusmaschine
```

### Protokoll-Stack

`Web Serial (FTDI) → 5-Baud-Init (BREAK 200 ms/Bit) → KWP2000 slow init (KW 0x45 0x05)
→ StartCommunication (0x81) → Ident/DTC/Live/Security/Flash-Services (ISO 14230)`

Schreibvorgänge sind durch ein **dreiagiges Schreib-Gate** gesichert:
Bestätigungsphrase „QFLASH21“ + Batteriespannung ≥ 12 V + vorheriger Backup-Lesevorgang.

## Sicherheit / Haftungsausschuss

Das Flashen von Steuergeräten kann **dauerhaften Schaden** verursachen (ECU-Brick, TÜV/ABE,
Garantieverlust, Fahrzeugrecht). Diese Software ist für Bildungszwecke und mit
**ausdrücklichem Backup** zu verwenden. Nutzung auf eigene Gefahr.

## Credits

- Protokoll-Referenz: [uholeschak/ediabaslib](https://github.com/uholeschak/ediabaslib)
- ISO 14230 (KWP2000 on K-Line), Bosch EDC15C4
