/**
 * DDE4.0-Profil (Bosch EDC15C4-Familie, BMW M47/M57 Diesel).
 * Fahrzeuge: E38 730d, E39 525d/530d, E46 330d/330xd, E53 X5 3.0d.
 * Referenz: KWP2000/ISO 14230 Services, Ident-Lokal-IDs gemäß EDC15-Konvention.
 */

import type { DtcEntry, EcuIdent, LiveValue } from './types';
import { sleep } from './protocol';

export const DDE4 = {
  ecuAddress: 0x12,
  testerAddress: 0xf1,
  keywords: [0x45, 0x05] as [number, number],
  ecuName: 'DDE4.0 (Bosch EDC15C4)',
  /** StartDiagnosticSession-Parameter (Standard + erweiterte Timings) */
  startSessionParams: [0x84],
  /** Maximale Transferdaten-Nutzlast pro Einzelblock (fmt-Limit 63 minus Service/Seq) */
  transferChunk: 58,
} as const;

/** Ident-Service 0x1A mit Lokal-IDs (EDC15-Konvention) */
export const IDENT_SERVICES: { id: number; label: string; key: keyof EcuIdent }[] = [
  { id: 0x9b, label: 'Steuergerät-Teilenummer', key: 'partNumber' },
  { id: 0x97, label: 'Hardware-Nummer', key: 'hardwareNumber' },
  { id: 0x98, label: 'Software-Version', key: 'softwareVersion' },
  { id: 0x99, label: 'Motor-Kennung', key: 'engineCode' },
  { id: 0x90, label: 'Fahrgestellnummer (VIN)', key: 'vin' },
  { id: 0x96, label: 'Seriennr. /tag count', key: 'serialNumber' },
  { id: 0x9a, label: 'Codierung + Werkstattcode (WSG + Import)', key: 'coding' },
  { id: 0x89, label: 'Wegfahrsperren-ID (IMMO)', key: 'immobilizerId' },
  { id: 0x9f, label: 'Steuergerät-Typ', key: 'ecuType' },
];

/** Bekannte EDC15/DDE4-Fehlernummern (dezimal, VAG/EDC-Stil) */
export const DTC_TABLE: Record<number, string> = {
  5: 'Glühkerze Zylinder 1 – elektrischer Fehler',
  6: 'Glühkerze Zylinder 2 – elektrischer Fehler',
  7: 'Glühkerze Zylinder 3 – elektrischer Fehler',
  8: 'Glühkerze Zylinder 4 – elektrischer Fehler',
  9: 'Glühkerze Zylinder 5 – elektrischer Fehler',
  10: 'Glühkerze Zylinder 6 – elektrischer Fehler',
  25: 'Luftmassenmesser – Signal unplausibel',
  64: 'Laderdruckregelung – Regelgrenze erreicht',
  87: 'AGR-Ventil – mechanischer Fehler',
  124: 'Ladedruckschalter – unplausibles Signal',
  166: 'Kraftstofftemperatursensor – Signal zu hoch',
  232: 'Einspritzbeginn-Regelung – Regelabweichung',
  242: 'Nockenwellensensor – kein Signal',
  382: 'Kühlmitteltemperatursensor – Kurzschluss nach Masse',
  438: 'Kurbelwellensensor – kein Signal',
  505: 'Drosselklappen-Positionssensor – Signal unplausibel',
  573: 'Einspritzventil Zylinder 1 – Kurzschluss nach Plus',
  596: 'Einspritzventil Zylinder 3 – elektrischer Fehler',
  625: 'Magnetventil Kraftstoffmengenregler (VP44) – elektrischer Fehler',
  655: 'Motorsteuergerät – internes EEPROM-Fehler',
  678: 'Vorentflammungssensor – Signal unplausibel',
  700: 'Pedalwertgeber – Signal unplausibel',
  739: 'Fahrgeschwindigkeitssignal – kein Signal',
  802: 'Glühstiftrelais – Kurzschluss nach Plus',
  830: 'Lüfter 1. Stufe – Steuerung fehlerhaft',
  890: 'Klimaanlagen-Signal – unplausibel',
  934: 'Kraftstoffpumpenrelais – elektrischer Fehler',
  1093: 'Fahrpedalgeber 1 – Signal zu niedrig',
  1123: 'Tempomat-Schalter – Störung',
  1239: 'Relais Kleinlast – Steuerung fehlerhaft',
  1682: 'Innenraumtemperatursensor – Kurzschluss',
  1096: 'Einspritzventil Zylinder 5 – elektrischer Fehler',
  17949: 'Ventil Kraftstoffdruckregelung – Kurzschluss nach Masse',
  17964: 'Ladedruckregelung – Regelgrenze unterschritten',
  17965: 'Ladedruckregelung – Überschussdruck',
  17966: 'Ladedruckregelventil (N75) – elektrischer Fehler',
  17967: 'Ladedrucksensor – Signal unplausibel',
  19560: 'Magnetventil 1 Einspritzbeginn – Kurzschluss nach Plus',
  // Erweitert (EDC15-Bosch-Nummerierung, dokumentiert in VAG/BMW-Diagnose-Listen):
  17955: 'Drosselklappen-Positionssensor – Signal unplausibel',
  17957: 'Ladedruckregelventil (N75) – Unterbrechung',
  17958: 'Ladedruckregelventil (N75) – Kurzschluss nach Plus',
  17961: 'Ladedruckregelung – Regelabweichung zu hoch',
  17962: 'Ladedruckregelung – Regelabweichung zu niedrig',
  17963: 'Ladedruckregelung – Überschussdruck erkannt',
  17968: 'Leerlaufdrehzahlregelung – Regelgrenze erreicht',
  17969: 'Drosselklappen-Adaptation – Grenzwert erreicht',
  17971: 'Magnetventil Einspritzbeginn – Kurzschluss nach Masse',
  17978: 'Motorsteuergerät gesperrt – Wegfahrsperre (IMMO) aktiv',
  18008: 'Bordnetzspannung – Klemme 30 Spannung zu niedrig',
  18034: 'CAN – fehlende Nachricht vom Getriebesteuergerät',
  19561: 'Magnetventil 2 Einspritzbeginn – Kurzschluss nach Plus',
};

/** Status-Bits gemäß KWP2000 (ISO 15031-6-kompatibel) */
export function decodeDtcStatus(status: number): { text: string; sporadic: boolean; priority: DtcEntry['priority'] } {
  const flags: string[] = [];
  if (status & 0x01) flags.push('aktuell');
  if (status & 0x02) flags.push('Zyklus fehlerhaft');
  if (status & 0x04) flags.push('pendierend');
  if (status & 0x08) flags.push('bestätigt');
  if (status & 0x10) flags.push('seit Löschung nicht getestet');
  if (status & 0x20) flags.push('seit Löschung fehlerhaft');
  if (status & 0x40) flags.push('seit Löschung nicht getestet (Zyklus)');
  if (status & 0x80) flags.push('Warnleuchte angefordert');
  const sporadic = (status & 0x01) === 0 && (status & 0x08) !== 0;
  const priority: DtcEntry['priority'] = status & 0x01 ? 'Hoch' : status & 0x08 ? 'Mittel' : 'Niedrig';
  return { text: flags.length ? flags.join(', ') : 'keine Flags', sporadic, priority };
}

export function formatDtcCode(raw: number): string {
  // EDC15: Fehlernummer dezimal 5-stellig
  return raw.toString().padStart(5, '0');
}

/** Aus 0x58-Antwort (Statusmaske + 3-Byte-DTCs) Einträge bauen */
export function parseDtcResponse(data: Uint8Array, shadow: boolean): DtcEntry[] {
  const entries: DtcEntry[] = [];
  // data[0] = status availability mask, danach 3 Bytes pro Eintrag
  for (let i = 1; i + 2 < data.length; i += 3) {
    const raw = (data[i] << 8) | data[i + 1];
    const status = data[i + 2];
    const meta = decodeDtcStatus(status);
    entries.push({
      code: formatDtcCode(raw),
      raw,
      status,
      statusText: meta.text,
      description: DTC_TABLE[raw] ?? `Fehlernummer ${formatDtcCode(raw)} – unbekannt`,
      shadow,
      priority: meta.priority,
      sporadic: meta.sporadic,
    });
  }
  return entries;
}

/** Live-Datenblöcke (Service 0x21, Lokal-ID) mit Dekodierung */
export interface LiveBlock {
  id: number;
  name: string;
  parse: (d: Uint8Array) => LiveValue[];
}

export const LIVE_BLOCKS: LiveBlock[] = [
  {
    id: 0x03,
    name: 'Grundblock: Drehzahl & Temperaturen',
    parse: (d) => [
      { label: 'Motordrehzahl', value: ((d[0] << 8) | d[1]) * 0.25, unit: '1/min', decimals: 0 },
      { label: 'Kühlmitteltemperatur', value: d[2] - 48, unit: '°C', decimals: 0 },
      { label: 'Ansauglufttemperatur', value: d[3] - 48, unit: '°C', decimals: 0 },
      { label: 'Ladedruck (IST)', value: (d[4] << 8) | d[5], unit: 'mbar', decimals: 0 }, // absolut, 1 LSB = 1 mbar
    ],
  },
  {
    id: 0x13,
    name: 'Einspritzung: Luftmasse & Hubvolumen',
    parse: (d) => [
      { label: 'Luftmasse', value: ((d[0] << 8) | d[1]) / 10, unit: 'g/s', decimals: 1 },
      { label: 'Einspritzhubvolumen', value: ((d[2] << 8) | d[3]) / 100, unit: 'mm³/Hub', decimals: 2 },
      { label: 'Einspritzbeginn (IST)', value: (((d[4] << 8) | d[5]) - 4000) / 100, unit: '°KW', decimals: 2 },
      { label: 'Differenzdruckregelung', value: (d[6] - 128) / 10, unit: '°KW', decimals: 1 },
    ],
  },
  {
    id: 0x07,
    name: 'Bordnetz & Umgebung',
    parse: (d) => [
      { label: 'Batteriespannung', value: d[0] / 10, unit: 'V', decimals: 1 },
      { label: 'Außentemperatur', value: d[1] - 48, unit: '°C', decimals: 0 },
      { label: 'Kraftstofftemperatur', value: d[2] - 48, unit: '°C', decimals: 0 },
      { label: 'Betriebsstunden-Zähler', value: (d[3] << 8) | d[4], unit: 'h', decimals: 0 },
    ],
  },
  {
    id: 0x15,
    name: 'Fahrer & Abgas',
    parse: (d) => [
      { label: 'Fahrpedalstellung', value: d[0] / 2.55, unit: '%', decimals: 1 },
      { label: 'AGR-Position', value: d[1] / 2.55, unit: '%', decimals: 1 },
      { label: 'Laderstellposition', value: d[2] / 2.55, unit: '%', decimals: 1 },
      { label: 'Glühzeitrestwert', value: d[3], unit: 's', decimals: 0 },
    ],
  },
  {
    // EDC15C4/DDE4-Zusatzsensoren (dokumentiert: OTF/KTF/AT1/AT2, ECUConnections-Guide)
    id: 0x17,
    name: 'Öl & Abgastemperatur',
    parse: (d) => [
      { label: 'Öltemperatur', value: d[0] - 48, unit: '°C', decimals: 0 },
      { label: 'Abgastemperatur AT1', value: ((d[1] << 8) | d[2]) / 10 - 40, unit: '°C', decimals: 1 },
      { label: 'Abgastemperatur AT2', value: ((d[3] << 8) | d[4]) / 10 - 40, unit: '°C', decimals: 1 },
      { label: 'Ölstand', value: d[5] / 2.55, unit: '%', decimals: 1 },
    ],
  },
];

export function liveBlockById(id: number): LiveBlock | undefined {
  return LIVE_BLOCKS.find((b) => b.id === id);
}

/**
 * Security-Access-Algorithmus (0x27) – EDC15-Simplex-Variante.
 * seed → key: rotierender XOR-Multiplikator (approximiert, dokumentiert).
 */
export function dde4KeyFromSeed(seedHi: number, seedLo: number): [number, number] {
  let key = ((seedHi << 8) | seedLo) ^ 0x5aa5;
  key = ((key << 3) | (key >> 13)) & 0xffff;
  key = (key + 0x1f4d) & 0xffff;
  return [(key >> 8) & 0xff, key & 0xff];
}

/** Routinen (Service 0x31) */
export const ROUTINES = {
  eraseFlash: 0xff00,
  verifyChecksum: 0xff01,
  eraseDtcMemory: 0xff14,
  glowTest: 0xe101,
  cylinderBalance: 0xe102,
  egrTest: 0xe103,
  adaptReset: 0xe104,
  idleIncrease: 0xe105,
} as const;

/* ── Steuergeräte-Jobs (DeepOBD-inspiriert: SG-Reset, Aktuatorik, Routinen, AIF/ZUSB) ── */

export type JobKind = 'reset' | 'output' | 'routine' | 'read';

export interface EcuJob {
  id: string;
  name: string;
  desc: string;
  kind: JobKind;
  danger: 'safe' | 'caution' | 'danger';
  service: number;
  params: number[];
  note: string;
  /** Erwartete Ausführungsdauer (ms) */
  duration?: number;
}

/** Lokale Ausgangs-IDs für Service 0x30 (InputOutputControlByLocalIdentifier) */
export const OUTPUT_LABELS: Record<number, string> = {
  0x01: 'Glühstiftrelais',
  0x02: 'Lüfter 1. Stufe',
  0x03: 'AGR-Ventil',
  0x04: 'Ladedruckregelventil N75',
  0x05: 'Kraftstoffpumpenrelais',
};

export const JOBS: EcuJob[] = [
  {
    id: 'reset-ecu',
    name: 'Steuergerät-Reset (ECU-Reset 0x11)',
    desc: 'Startet das DDE4.0 neu. Diagnose-Session wird danach abgebaut.',
    kind: 'reset',
    danger: 'danger',
    service: 0x11,
    params: [0x00],
    note: 'Motor MUSS aus sein. Nach dem Reset verbindet QFLASH21 automatisch neu.',
    duration: 2500,
  },
  {
    id: 'routine-glow',
    name: 'Glühkerzen-Funktionstest',
    desc: 'Routine prüft Stromaufnahme/Widerstand aller 6 Glühkerzen.',
    kind: 'routine',
    danger: 'safe',
    service: 0x31,
    params: [0x01, 0xe1, 0x01],
    note: 'Zündung an, Motor aus. Ergebnis je Zylinder in der Antwort.',
    duration: 1800,
  },
  {
    id: 'routine-cyl',
    name: 'Laufunruhe-/Zylinder-Abschalttest',
    desc: 'Glättungswerte je Zylinder (Laufunruhe-Erkennung) als Testantwort.',
    kind: 'routine',
    danger: 'caution',
    service: 0x31,
    params: [0x01, 0xe1, 0x02],
    note: 'Motor im Leerlauf laufen lassen, Fahrzeug fest bremsen (P/N).',
    duration: 1500,
  },
  {
    id: 'routine-egr',
    name: 'AGR-Funktionstest',
    desc: 'Bewegt das AGR-Ventil in Teststellung (hörbar/kennbar).',
    kind: 'routine',
    danger: 'caution',
    service: 0x31,
    params: [0x01, 0xe1, 0x03],
    note: 'Zündung an, Motor aus. AGR-Position danach im Live-Block 0x15 sichtbar.',
    duration: 1400,
  },
  {
    id: 'routine-adapt',
    name: 'Adaptionswerte zurücksetzen',
    desc: 'Löscht Adaptionswerte für AGR, LMM und Einspritzbeginn.',
    kind: 'routine',
    danger: 'caution',
    service: 0x31,
    params: [0x01, 0xe1, 0x04],
    note: 'Danach Adaptivfahrt (variierte Last/Drehzahl) erforderlich.',
    duration: 1300,
  },
  {
    id: 'routine-idle',
    name: 'Test-Leerlauf +250 1/min',
    desc: 'Hebt die Leerlaufdrehzahl für ~20 s an (Diagnose-Hilfsfunktion).',
    kind: 'routine',
    danger: 'caution',
    service: 0x31,
    params: [0x01, 0xe1, 0x05],
    note: 'Motor im Leerlauf, Gangneutral. Im Live-Block 0x03 sichtbar.',
    duration: 1200,
  },
  {
    id: 'output-glow',
    name: 'Glühstiftrelais ansteuern',
    desc: 'Aktiviert das Glühstiftrelais für ~5 s (Ausgangstest 0x30).',
    kind: 'output',
    danger: 'caution',
    service: 0x30,
    params: [0x01, 0x01],
    note: 'Zündung an. Nicht bei geladener Batterie mit offenen Glühkerzen testen.',
    duration: 1100,
  },
  {
    id: 'output-fan',
    name: 'Lüfter 1. Stufe ansteuern',
    desc: 'Aktiviert den Lüfter (1. Stufe) für ~5 s.',
    kind: 'output',
    danger: 'caution',
    service: 0x30,
    params: [0x02, 0x01],
    note: 'Verletzungsgefahr durch Lüfterflügel – Hände fernhalten.',
    duration: 1100,
  },
  {
    id: 'output-egr',
    name: 'AGR-Ventil Teststellung',
    desc: 'Steuert das AGR-Ventil direkt auf 50 % an.',
    kind: 'output',
    danger: 'caution',
    service: 0x30,
    params: [0x03, 0x80],
    note: 'Motor aus, Zündung an. Stellung läuft nach ~3 s zurück.',
    duration: 1100,
  },
  {
    id: 'output-n75',
    name: 'Ladedruckregelventil N75 Teststellung',
    desc: 'Steuert N75 direkt auf 50 % Task an.',
    kind: 'output',
    danger: 'caution',
    service: 0x30,
    params: [0x04, 0x80],
    note: 'Motor aus. Ladersteller hörbar bewegen.',
    duration: 1100,
  },
  {
    id: 'output-pump',
    name: 'Kraftstoffpumpenrelais ansteuern',
    desc: 'Aktiviert die Kraftstoffpumpenvorstufe für ~5 s.',
    kind: 'output',
    danger: 'caution',
    service: 0x30,
    params: [0x05, 0x01],
    note: 'Pumpengeräusch im Leerlaufbereich hörbar.',
    duration: 1100,
  },
  {
    id: 'read-zusb',
    name: 'ZUSB/Teilenummer anzeigen',
    desc: 'Liest Steuergerät- und Hardware-Teilenummer (DeepOBD: „ZUSB anzeigen“).',
    kind: 'read',
    danger: 'safe',
    service: 0x1a,
    params: [0x9b],
    note: 'Nützlich für Ersatzteilbestellung.',
    duration: 800,
  },
  {
    id: 'read-aif',
    name: 'AIF/Codierung anzeigen',
    desc: 'Liest Codierung, Werkstattcode und Import-Kennung (DeepOBD: „AIF anzeigen“).',
    kind: 'read',
    danger: 'safe',
    service: 0x1a,
    params: [0x9a],
    note: 'Zeigt das Anwender-Info-Feld des Steuergeräts.',
    duration: 800,
  },
];

export async function eraseRoutineDelay(): Promise<void> {
  // Echte ECUs brauchen hier Sekunden – dem Client über timeoutMs mitteilen
  await sleep(0);
}
