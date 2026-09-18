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
  17949: 'Ventil Kraftstoffdruckregelung – Kurzschluss nach Masse',
  17964: 'Ladedruckregelung – Regelgrenze unterschritten',
  17965: 'Ladedruckregelung – Überschussdruck',
  17966: 'Ladedruckregelventil (N75) – elektrischer Fehler',
  17967: 'Ladedrucksensor – Signal unplausibel',
  19560: 'Magnetventil 1 Einspritzbeginn – Kurzschluss nach Plus',
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
} as const;

export async function eraseRoutineDelay(): Promise<void> {
  // Echte ECUs brauchen hier Sekunden – dem Client über timeoutMs mitteilen
  await sleep(0);
}
