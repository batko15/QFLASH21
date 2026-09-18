/**
 * Bosch CR2-Prüfsummen-Engine (EDC15/DDE4-Konvention).
 *
 * Das Flash-Image ist in 16-KiB-Bänke geteilt. Jede Bank endet mit
 * zwei identischen 16-Bit-Wörtern (Little Endian), die die Summe
 * aller Bytes der Bank (ohne die Prüfsummenwörter selbst) mod 0x10000
 * enthalten ("CR" = Checksum Redundancy 2).
 *
 * Die ersten 16 KiB (Boot/Immobilizer-Bereich) sind geschützt und
 * dürfen nicht verändert werden.
 */

import type { ChecksumBlockResult } from './types';

export const BANK_SIZE = 0x4000; // 16 KiB
export const PROTECTED_AREA_SIZE = BANK_SIZE; // erste 16 KiB geschützt
export const FULL_SIZE = 0x80000; // 512 KiB
export const CAL_SIZE = 0xc000; // 48 KiB
/** CAL-Bereich = letzte 3 Bänke im FULL-Image */
export const CAL_OFFSET_IN_FULL = FULL_SIZE - CAL_SIZE;

export function cr2Sum(data: Uint8Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum = (sum + data[i]) & 0xffff;
  return sum;
}

export function computeBankChecksum(image: Uint8Array, bankOffset: number): ChecksumBlockResult {
  const bankEnd = bankOffset + BANK_SIZE;
  if (bankEnd > image.length) throw new Error(`Bank übersteigt Bildgröße (Offset 0x${bankOffset.toString(16)})`);
  const csOffset = bankEnd - 4;
  const calculated = cr2Sum(image, bankOffset, csOffset);
  const stored = image[csOffset] | (image[csOffset + 1] << 8);
  const stored2 = image[csOffset + 2] | (image[csOffset + 3] << 8);
  return {
    bankIndex: Math.floor(bankOffset / BANK_SIZE),
    offset: csOffset,
    start: bankOffset,
    end: csOffset,
    calculated,
    stored,
    ok: stored === calculated && stored2 === calculated,
  };
}

export function computeAllChecksums(image: Uint8Array): ChecksumBlockResult[] {
  const res: ChecksumBlockResult[] = [];
  for (let off = 0; off + BANK_SIZE <= image.length; off += BANK_SIZE) {
    res.push(computeBankChecksum(image, off));
  }
  return res;
}

/** Alle Bänke neu berechnen und zurückschreiben. Gibt Anzahl korrigierter Bänke zurück. */
export function fixAllChecksums(image: Uint8Array): number {
  let fixed = 0;
  for (const r of computeAllChecksums(image)) {
    if (!r.ok) {
      image[r.offset] = r.calculated & 0xff;
      image[r.offset + 1] = (r.calculated >> 8) & 0xff;
      image[r.offset + 2] = r.calculated & 0xff;
      image[r.offset + 3] = (r.calculated >> 8) & 0xff;
      fixed++;
    }
  }
  return fixed;
}

/** Prüfen, ob ein Schreibvorgang in den geschützten Bereich (erste 16 KiB) greift */
export function touchesProtectedArea(offset: number): boolean {
  return offset < PROTECTED_AREA_SIZE;
}
