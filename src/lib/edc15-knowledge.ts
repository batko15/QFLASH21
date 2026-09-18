/**
 * EDC15C4 / DDE 4.0 – Wissensbasis für Kalibrierung & Diagnose (BMW M57D30).
 *
 * Quellen (vom Nutzer bereitgestellter Fachbericht „KI-Tuning-Agent für BMW EDC15
 * Konfiguration“, 2026; vollständig aufbereitet in docs/EDC15C4-KI-AGENT.md):
 *  - Bosch Funktionsbeschreibung EDC15C B079.CC0 (via github.com/GabrielStanescu/BMW_M57_EDC15C4)
 *  - XDF-Definitionen: github.com/dmacpro91/BMW-XDFs (z. B. Fahrerwunsch @ 0x78B0E, HW 0281010314)
 *  - ecuedit.com-Foren (BMW EDC15C4 Map-Adressen)
 *
 * WICHTIG: Referenzwissen für Werkstatt/Analysis. Keine Automatik – jede Modifikation
 * erfordert zwingend die EDC15-Prüfsummenkorrektur (sonst Brick-Gefahr!).
 */

export interface HardwareLimit {
  id: string;
  title: string;
  limit: string;
  detail: string;
  severity: 'critical' | 'warning';
}

/** Motor & Steuergerät */
export const ENGINE = {
  engine: 'BMW M57D30 (2,9 l R6 Turbodiesel)',
  ecu: 'Bosch EDC15C4 / DDE 4.0',
  injection: 'Common Rail 1. Gen (Bosch CP1-Hochdruckpumpe, Magnetventil-Injektoren)',
  turbo: 'Garrett GT2556V (VTG)',
  vehicles: 'E38 730d · E39 525d/530d · E46 330d/330xd · E53 X5 3.0d',
  serial: { ps: 184, nm: 390 },
  /** Einspritzmenge seriennah bei 390 Nm / 1750 U/min */
  serialIqMg: 58,
  serialIqMm3: 69,
} as const;

/** Stage-1-Ziel (aus dem KI-Tuning-Bericht): 230 PS / 480 Nm */
export const STAGE1 = {
  ps: 230,
  nm: 480,
  iqMg: 71.5, // Zielbereich 71–73 mg/Hub
  iqMgRange: [71, 73] as const,
  iqMm3: 85,
  boostAbs: '2250–2350 mbar (absolut, inkl. Umgebungsdruck)',
  note: 'Fahrerwunsch bei TPS 80–100 % anheben; Drehmomentbegrenzer in der 1000-mbar-Spalte (Meereshöhe) auf ca. 68–72 mg/Hub bei 2000–2500 U/min.',
} as const;

/** Limiter-Kette: IQ_final = min(Fahrerwunsch, Drehmomentbegrenzer, Rauchbegrenzer) */
export const LIMITER_CHAIN = [
  {
    id: 'driver',
    label: 'Fahrerwunsch (Drivers Wish)',
    map: 'RPM × Pedalwert (TPS %) → IQ',
    detail:
      '3D-Matrix. Mehr Leistung durch Anhebung des Wunschwerts bei hohen Pedalstellungen (80–100 %). Referenzadresse HW 0281010314: 0x78B0E (XDF dmacpro91/BMW-XDFs).',
  },
  {
    id: 'torque',
    label: 'Drehmomentbegrenzer (Torque Limiter)',
    map: 'RPM × Atmosphärendruck → IQ',
    detail:
      'Schützt Kupplung, Getriebe, Motorblock. Auf Meereshöhe (~1015 mbar, Gelibolu) läuft der Motor praktisch immer in der 1000-mbar-Spalte. 390 Nm ≈ 69 mm³ (58 mg); 480 Nm ≈ 85 mm³ (71–73 mg).',
  },
  {
    id: 'smoke',
    label: 'Rauchbegrenzer (IQ by MAF)',
    map: 'RPM × Luftmasse (MAF) → IQ',
    detail:
      'Sicherheitskritisch: diktiert das zulässige Luft-Kraftstoff-Verhältnis. Validierung zwingend: AFR = MAF / IQ_final ≥ 16,0 (λ ≥ 1,1) – sonst Ruß + extreme Abgastemperaturen.',
  },
] as const;

/** Harte Hardware-Grenzwerte (Guardrails) */
export const HARDWARE_LIMITS: HardwareLimit[] = [
  {
    id: 'rail-pressure',
    title: 'Raildruck – Bosch CP1-Pumpe',
    limit: 'max. 1350 bar',
    detail:
      'Die CP1 ist mechanisch nicht für > 1400 bar ausgelegt. Überschreitung → rasante Verschleißentwicklung, Leckagen und „Rail Pressure Plausibility“-Fehler (z. B. Code 4496) mit Notlauf/Abstellen. Mehr Kraftstoff über Einspritzdauer (Duration/SOI) erreichen – NIEMALS über Raildruck.',
    severity: 'critical',
  },
  {
    id: 'boost',
    title: 'Ladedruck – Garrett GT2556V',
    limit: 'max. 2250–2350 mbar (abs.)',
    detail:
      'Boost-Target im mittleren Drehzahlband konservativ halten. Mehr Ladedruck riskiert Turbinen- und Kolbenschäden. Für Stage 1 (230 PS) reicht der genannte Bereich aus.',
    severity: 'critical',
  },
  {
    id: 'svbl',
    title: 'SVBL (Single Value Boost Limiter)',
    limit: 'Boost-Max + 100…150 mbar',
    detail:
      '16-Bit-Notabschaltung. Muss exakt 100–150 mbar ÜBER dem höchsten Wert des Ladedruckkennfelds liegen (z. B. Soll 2300 mbar → SVBL 2450 mbar). Schutz vor Boost Creep/Überschwingen.',
    severity: 'warning',
  },
  {
    id: 'afr',
    title: 'Rauchbegrenzung (AFR/Lambda)',
    limit: 'AFR ≥ 16,0 (λ ≥ 1,1)',
    detail:
      'Formel: AFR = MAF / IQ_final. Fällt das AFR unter 16:1, verbrennt der Kraftstoff unvollständig → schwarzer Rauch, extrem hohe Abgastemperaturen.',
    severity: 'warning',
  },
  {
    id: 'iat',
    title: 'Ansauglufttemperatur (IAT)',
    limit: 'ab 65 °C IQ reduzieren',
    detail:
      'Im heißen Sommer (Çanakkale: oft > 31 °C Umgebung) erreicht die IAT unter Volllast 55–60 °C. Hohe IAT senkt die Sauerstoffmasse → heißere Verbrennung → EGT-Anstieg. IAT-korrelierte Begrenzer so kalibrieren, dass ab 65 °C die IQ graduell abgebaut wird.',
    severity: 'warning',
  },
] as const;

/** Workflow „Stage 1“ (4 Schritte aus dem AGENTS.md-System-Prompt) */
export const WORKFLOW_STEPS = [
  {
    id: 1,
    title: 'Diagnose & Status quo',
    items: [
      'Fahrlog/CSV auswerten: Maximalwerte für Ladedruck (mbar), Raildruck (bar), Luftmasse (mg/Hub), Kühlmitteltemperatur (°C).',
      'Delta Ladedruck-SOLL vs. IST prüfen: > 150 mbar über > 2 s → VNT-Overboost (N75-Anpassung nötig).',
    ],
  },
  {
    id: 2,
    title: 'Map-Struktur extrahieren (XDF)',
    items: [
      'XDF zur Hardware-Nummer (z. B. 0281010314) laden; Adressen, Wortbreite, Endianness und <MATH>-Faktoren lesen.',
      'Pflicht-Maps: Fahrerwunsch, Drehmomentbegrenzer, Rauchbegrenzer, Boost Target, SVBL, Raildruck.',
    ],
  },
  {
    id: 3,
    title: 'Grenzwerte definieren (Guardrails)',
    items: [
      'Raildruck ≤ 1350 bar (CP1-Limit) – Kraftstoffmehrung nur über Duration/SOI.',
      'Ladedruck 2250–2350 mbar abs.; SVBL = Boost-Max + 150 mbar.',
      'AFR ≥ 16,0 validieren; Fokus Torque-Limiter auf 950–1050 mbar-Spalten (Meereshöhe).',
    ],
  },
  {
    id: 4,
    title: 'Modifikation + Prüfsumme (Human-in-the-Loop)',
    items: [
      'Neue Hexwerte aus <MATH>-Gleichung rechnen; Vergleichstabelle Soll/Ist in physikalischen Einheiten erstellen.',
      'VOR dem Schreiben: Backup! Schreiben nur mit bestätigter EDC15-Prüfsummenkorrektur – sonst Brick-Gefahr.',
    ],
  },
] as const;

/** Klimatologie Referenzstandort Gelibolu, Çanakkale (TR) – für Umgebungsmodelle */
export const CLIMATE_GELIBOLU = [
  { month: 'Januar', mbar: 1017.7, humidity: '80 %', rain: '100,5 mm' },
  { month: 'April', mbar: 1014.4, humidity: '68 %', rain: '56,6 mm' },
  { month: 'Juli', mbar: 1011.4, humidity: '53–57 %', rain: '16,5 mm' },
  { month: 'Oktober', mbar: 1018.2, humidity: '71 %', rain: '58,6 mm' },
] as const;

export const CLIMATE_NOTE =
  'Gelibolu liegt auf ~41 m Höhe; Umgebungsdruck fast konstant 1010–1025 mbar. Kritisch für den atmosphärischen Drehmomentbegrenzer: Der Motor operiert dauerhaft in der 1000-mbar-Spalte. Juli: Ø-Maxima 30–31 °C, Extrema bis 33 °C → IAT-/EGT-Absicherung zwingend.';

/** Referenzen & Werkzeuge */
export const REFERENCES = [
  { label: 'Bosch EDC15C B079.CC0 (Funktionsbeschreibung)', url: 'https://github.com/GabrielStanescu/BMW_M57_EDC15C4' },
  { label: 'BMW-XDFs (TunerPro-Definitionen)', url: 'https://github.com/dmacpro91/BMW-XDFs' },
  { label: 'BMW-DDE4-EDC15c4-EcuID (23 Dumps)', url: 'https://github.com/Mursteinen/BMW-DDE4-EDC15c4-EcuID' },
  { label: 'ecuedit.com – BMW EDC15C4 Map-Adressen', url: 'https://www.ecuedit.com/bmw-m57-edc15c4-tuning-t4831' },
] as const;

/** Tuning-relevante Fehlernummern mit Fachhinweis (Ergänzung zur DTC_TABLE in kwp/dde4.ts) */
export const DTC_TUNING_NOTES: Record<number, string> = {
  4496: 'Rail Pressure Plausibility: Raildruck-Ist weicht vom Sollwert ab. Typische Ursachen: Raildruck-Kennfeld über 1350 bar (CP1-Limit!), Pumpen-/Injektoren-Verschleiß, Leckage. Folge: Notlauf oder Abstellen. Raildruck-Soll niemals über 1350 bar kalibrieren.',
};

/* ------------------------------------------------------------------ */
/* Berechnungen                                                        */
/* ------------------------------------------------------------------ */

/** Dichte Diesel ≈ 0,84 g/cm³ → mm³ → mg (DDE-Derivat-abhängig, ±5 %) */
export function mm3ToMg(mm3: number): number {
  return mm3 * 0.84;
}

export function mgToMm3(mg: number): number | null {
  if (!Number.isFinite(mg) || mg <= 0) return null;
  return mg / 0.84;
}

/**
 * AFR = MAF / IQ (beide in mg/Hub). Dieselmager: ≥ 16 ok, < 16 Ruß.
 * @returns null bei ungültigen Eingaben
 */
export function calcAfr(mafMg: number, iqMg: number): number | null {
  if (!Number.isFinite(mafMg) || !Number.isFinite(iqMg) || iqMg <= 0) return null;
  return mafMg / iqMg;
}

/** SVBL-Empfehlung: [Boost-Max + 100, Boost-Max + 150] mbar (absolut) */
export function svblRange(boostTargetMaxMbar: number): [number, number] | null {
  if (!Number.isFinite(boostTargetMaxMbar) || boostTargetMaxMbar <= 0) return null;
  return [Math.round(boostTargetMaxMbar + 100), Math.round(boostTargetMaxMbar + 150)];
}

/**
 * IQ (mg/Hub) → Drehmoment (Nm) – lineare Näherung durch die Referenzpunkte
 * 58 mg → 390 Nm und 71,5 mg → 480 Nm (M57D30). Grobe Schätzung ±10 %!
 */
const IQ_NM_SLOPE = (480 - 390) / (STAGE1.iqMg - ENGINE.serialIqMg); // ≈ 6,67 Nm/mg
export function iqToNm(iqMg: number): number | null {
  if (!Number.isFinite(iqMg) || iqMg <= 0) return null;
  return ENGINE.serial.nm + (iqMg - ENGINE.serialIqMg) * IQ_NM_SLOPE;
}

export function nmToIq(nm: number): number | null {
  if (!Number.isFinite(nm) || nm <= 0) return null;
  return ENGINE.serialIqMg + (nm - ENGINE.serial.nm) / IQ_NM_SLOPE;
}

/** Deutsch formatierte Zahl */
export function fmt(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
