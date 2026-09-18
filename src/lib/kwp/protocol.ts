/**
 * KWP2000 (ISO 14230) Framing über K-Line.
 * Format: [0x80|len] [target] [source] [service] [data…] [checksum]
 * len = Anzahl Bytes ab Service-Byte (inkl. Service).
 * Checksumme = Summe aller vorherigen Bytes mod 256.
 * K-Line ist Eindraht: Alles Gesendete wird als Echo empfangen –
 * der Client verwirft das Echo vor dem Parsen der Antwort.
 */

import type { ParsedFrame } from './types';

export { KwpError } from './types';

export const TESTER_ADDRESS = 0xf1;
/** Standard-K-Line-Adresse für BMW Motorsteuergeräte (DME/DDE) */
export const DEFAULT_ECU_ADDRESS = 0x12;

export function kwpChecksum(bytes: Uint8Array | number[]): number {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xff;
  return s;
}

export function buildRequest(
  service: number,
  data: ArrayLike<number>,
  opts?: { target?: number; source?: number }
): Uint8Array {
  const target = opts?.target ?? DEFAULT_ECU_ADDRESS;
  const source = opts?.source ?? TESTER_ADDRESS;
  const len = data.length + 1; // Service-Byte zählt mit
  if (len > 0x3f) throw new KwpFrameError(`Frame zu lang (${len} > 63) – Einzelblock-Limit`);
  const head = [0x80 | len, target, source];
  const body = [service, ...Array.from(data)];
  const all = [...head, ...body];
  return new Uint8Array([...all, kwpChecksum(all)]);
}

export class KwpFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KwpFrameError';
  }
}

export function parseFrame(buf: Uint8Array): ParsedFrame {
  if (buf.length < 5) throw new KwpFrameError('Frame zu kurz');
  const cs = kwpChecksum(buf.subarray(0, buf.length - 1));
  if (cs !== buf[buf.length - 1]) throw new KwpFrameError('Prüfsummenfehler im Empfangsframe');
  const fmt = buf[0];
  let start = 1;
  let target = 0;
  let source = 0;
  if (fmt & 0x80) {
    target = buf[1];
    source = buf[2];
    start = 3;
  } else if (fmt & 0x40) {
    throw new KwpFrameError('Nicht unterstütztes Adressierungsformat');
  }
  const len = fmt & 0x3f;
  if (buf.length < start + len + 1) throw new KwpFrameError('Frame unvollständig');
  const service = buf[start];
  const data = buf.slice(start + 1, start + len);
  return { fmt, target, source, service, data };
}

export const NRC_DESCRIPTIONS: Record<number, string> = {
  0x10: 'Allgemeine Ablehnung (GR)',
  0x11: 'Service nicht unterstützt (SNS)',
  0x12: 'Subfunktion nicht unterstützt (SFNS)',
  0x13: 'Falsches Nachrichtenformat (IMLIF)',
  0x21: 'Busy – Anfrage wiederholen (BRC)',
  0x22: 'Bedingungen nicht erfüllt (CNC)',
  0x24: 'Anfrage außerhalb der Sequenz (RSE)',
  0x31: 'Anfrage außerhalb des Bereichs (SOR)',
  0x33: 'Security Access verweigert (SAD)',
  0x35: 'Ungültiger Schlüssel (IK)',
  0x36: 'Überzählige Versuche (ENOA)',
  0x37: 'Zeitverzögerung aktiv (RTDNE)',
  0x72: 'Allgemeiner Programmierfehler (GPF)',
  0x78: 'Response pending (RCRRP)',
  0x7e: 'Subfunktion nicht unterstützt im aktuellen Session-Zustand (SFNSIAS)',
  0x81: 'Programmfehler beim Answeren',
};

export function describeNrc(nrc: number): string {
  return NRC_DESCRIPTIONS[nrc] ?? `Unbekannter NRC 0x${nrc.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Hex-Dump-Zeile erzeugen */
export function toHex(bytes: Uint8Array | number[], max = 64): string {
  const arr = Array.from(bytes).slice(0, max);
  return arr.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ParsedFrame kommt aus ./types.ts
