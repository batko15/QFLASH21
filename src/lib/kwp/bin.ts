/**
 * BIN-Verwaltung: FULL (512 KiB) und CAL (48 KiB) Images,
 * Diff-Berechnung, Hex-Dump und Download-Hilfen.
 */

import type { BinKind, DiffRegion } from './types';
import { BANK_SIZE, CAL_OFFSET_IN_FULL, FULL_SIZE, CAL_SIZE, computeAllChecksums } from './checksum';

export function detectBinKind(size: number): BinKind {
  if (size === FULL_SIZE) return 'FULL';
  if (size === CAL_SIZE) return 'CAL';
  return 'UNKNOWN';
}

export interface BinAnalysis {
  kind: BinKind;
  size: number;
  banks: number;
  checksumsOk: number;
  checksumsBad: number;
  protectedTouched: boolean;
}

export function analyzeBin(data: Uint8Array): BinAnalysis {
  const kind = detectBinKind(data.length);
  const results = computeAllChecksums(data);
  return {
    kind,
    size: data.length,
    banks: Math.floor(data.length / BANK_SIZE),
    checksumsOk: results.filter((r) => r.ok).length,
    checksumsBad: results.filter((r) => !r.ok).length,
    protectedTouched: false,
  };
}

/** Geänderte Regionen zwischen zwei Images finden (zusammenhängende Läufe) */
export function diffBins(a: Uint8Array, b: Uint8Array, minGap = 16): { changedBytes: number; regions: DiffRegion[] } {
  if (a.length !== b.length) throw new Error(`Bildgrößen unterscheiden sich (${a.length} vs ${b.length})`);
  const changed: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) changed.push(i);
  }
  const regions: DiffRegion[] = [];
  let start = -1;
  let end = -1;
  for (const idx of changed) {
    if (start === -1) {
      start = idx;
      end = idx;
    } else if (idx - end <= minGap) {
      end = idx;
    } else {
      regions.push({ start, end: end + 1, bytes: end + 1 - start });
      start = idx;
      end = idx;
    }
  }
  if (start !== -1) regions.push({ start, end: end + 1, bytes: end + 1 - start });
  return { changedBytes: changed.length, regions };
}

/** CAL-Region extrahieren aus einem FULL-Image */
export function extractCal(full: Uint8Array): Uint8Array {
  return full.slice(CAL_OFFSET_IN_FULL, FULL_SIZE);
}

export function hexDump(data: Uint8Array, offset: number, length: number, bytesPerRow = 16): string {
  const rows: string[] = [];
  const end = Math.min(offset + length, data.length);
  for (let i = offset; i < end; i += bytesPerRow) {
    const slice = data.subarray(i, Math.min(i + bytesPerRow, end));
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('');
    rows.push(
      `${i.toString(16).padStart(8, '0').toUpperCase()}  ${hex.padEnd(bytesPerRow * 3 - 1, ' ')}  |${ascii}|`
    );
  }
  return rows.join('\n');
}

export function downloadBin(filename: string, data: Uint8Array): void {
  const blob = new Blob([data.slice()], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function formatHexOffset(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(5, '0')}`;
}
