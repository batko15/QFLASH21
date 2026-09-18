'use client';

import { useRef, useState } from 'react';
import { GitCompareArrows, FileUp, X, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher } from '@/store/flasher';
import { diffBins, formatHexOffset, formatSize } from '@/lib/kwp/bin';
import { FULL_SIZE, touchesProtectedArea } from '@/lib/kwp/checksum';
import type { DiffRegion } from '@/lib/kwp/types';
import { cn } from '@/lib/utils';

interface CompareSlot {
  name: string;
  data: Uint8Array;
}

const MAX_REGIONS_SHOWN = 300;

function hexPreview(data: Uint8Array, start: number, end: number): string {
  const slice = data.slice(start, Math.min(end + 1, start + 8));
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

/** 16-KiB-Bank eines Offsets (Bosch-CR2-Einteilung) */
function bankOf(offset: number): number {
  return Math.floor(offset / 16384);
}

export function BinDiffCard() {
  const bin = useFlasher((s) => s.bin);
  const ecuBin = useFlasher((s) => s.ecuBin);

  const [slotA, setSlotA] = useState<CompareSlot | null>(null);
  const [slotB, setSlotB] = useState<CompareSlot | null>(null);
  const [result, setResult] = useState<{ changedBytes: number; regions: DiffRegion[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputA = useRef<HTMLInputElement>(null);
  const inputB = useRef<HTMLInputElement>(null);

  async function readFile(file: File): Promise<CompareSlot> {
    const buf = new Uint8Array(await file.arrayBuffer());
    return { name: file.name, data: buf };
  }

  async function onPickA(file: File | undefined) {
    if (!file) return;
    try {
      const s = await readFile(file);
      setSlotA(s);
      setResult(null);
      setError(null);
    } catch {
      setError('Datei A konnte nicht gelesen werden');
    }
  }

  async function onPickB(file: File | undefined) {
    if (!file) return;
    try {
      const s = await readFile(file);
      setSlotB(s);
      setResult(null);
      setError(null);
    } catch {
      setError('Datei B konnte nicht gelesen werden');
    }
  }

  function useEcuAsA() {
    if (!ecuBin) return;
    setSlotA({ name: ecuBin.name, data: ecuBin.data });
    setResult(null);
    setError(null);
  }

  function useUploadedAsA() {
    if (!bin) return;
    setSlotA({ name: bin.name, data: bin.data });
    setResult(null);
    setError(null);
  }

  function runDiff() {
    if (!slotA || !slotB) return;
    if (slotA.data.length !== slotB.data.length) {
      setError(`Bildgrößen unterscheiden sich (${formatSize(slotA.data.length)} vs ${formatSize(slotB.data.length)})`);
      setResult(null);
      return;
    }
    try {
      const r = diffBins(slotA.data, slotB.data, 16);
      setResult(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diff fehlgeschlagen');
      setResult(null);
    }
  }

  const isFullImage = slotA?.data.length === FULL_SIZE;
  const protectedHit = result && isFullImage
    ? result.regions.some((r) => touchesProtectedArea(r.start))
    : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-primary" aria-hidden />
          BIN-Diff-Viewer
        </CardTitle>
        <CardDescription>
          Zwei Images bytegenau vergleichen (z. B. ECU-Backup vs. modifizierter BIN) – inkl. Bank- und
          Schutz-Zonen-Analyse.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Slot A */}
          <div className="rounded-lg border p-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">QUELLE (A)</p>
            {slotA ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{slotA.name}</p>
                <Badge variant="outline">{formatSize(slotA.data.length)}</Badge>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Quelle entfernen" onClick={() => { setSlotA(null); setResult(null); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={useEcuAsA} disabled={!ecuBin}>
                  ECU-Backup
                </Button>
                <Button size="sm" variant="outline" onClick={useUploadedAsA} disabled={!bin}>
                  Hochgeladene BIN
                </Button>
                <Button size="sm" variant="ghost" onClick={() => inputA.current?.click()}>
                  <FileUp /> Datei …
                </Button>
                <input ref={inputA} type="file" accept=".bin,.rom,.ori,.mod" className="hidden" aria-label="Quell-BIN wählen" onChange={(e) => void onPickA(e.target.files?.[0])} />
              </div>
            )}
          </div>

          {/* Slot B */}
          <div className="rounded-lg border p-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">VERGLEICH (B)</p>
            {slotB ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{slotB.name}</p>
                <Badge variant="outline">{formatSize(slotB.data.length)}</Badge>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Vergleich entfernen" onClick={() => { setSlotB(null); setResult(null); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => inputB.current?.click()}>
                <FileUp /> Datei wählen …
              </Button>
            )}
            <input ref={inputB} type="file" accept=".bin,.rom,.ori,.mod" className="hidden" aria-label="Vergleichs-BIN wählen" onChange={(e) => void onPickB(e.target.files?.[0])} />
          </div>
        </div>

        <Button onClick={runDiff} disabled={!slotA || !slotB}>
          <GitCompareArrows /> Vergleichen
        </Button>

        {error && (
          <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" role="alert">{error}</p>
        )}

        {result && slotA && slotB && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Geänderte Bytes</p>
                <p className="font-mono text-xl font-bold">{result.changedBytes.toLocaleString('de-DE')}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Regionen</p>
                <p className="font-mono text-xl font-bold">{result.regions.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Betroffene 16-KiB-Bänke</p>
                <p className="font-mono text-xl font-bold">
                  {[...new Set(result.regions.map((r) => bankOf(r.start)))].sort((a, b) => a - b).join(', ') || '–'}
                </p>
              </div>
              {isFullImage ? (
                <div className={cn('rounded-lg border p-3', protectedHit && 'border-destructive/60')}>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldAlert className={cn('h-3.5 w-3.5', protectedHit && 'text-destructive')} aria-hidden />
                    Schutzzone (16 KiB)
                  </p>
                  <p className={cn('text-sm font-bold', protectedHit ? 'text-destructive' : 'text-success')}>
                    {protectedHit ? 'BERÜHRT!' : 'unberührt'}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Bildtyp</p>
                  <p className="text-sm font-bold">CAL ({formatSize(slotA?.data.length ?? 0)})</p>
                  <p className="text-[10px] text-muted-foreground">Schutz-Zonen-Check nur bei FULL</p>
                </div>
              )}
            </div>

            {protectedHit && (
              <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                ⚠️ Unterschiede liegen in der geschützten Zone (erste 16 KiB) – dieses Image nicht ohne
                genaue Prüfung flashen (Bootblock/Immobilizer-Bereich)!
              </p>
            )}

            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Regionen (Adresse · alter → neuer Hex, max. {MAX_REGIONS_SHOWN} von {result.regions.length}):
              </p>
              <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/20 font-mono text-xs custom-scrollbar" role="list" aria-label="Diff-Regionen">
                {result.regions.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">Identische Images – keine Unterschiede.</p>
                ) : (
                  result.regions.slice(0, MAX_REGIONS_SHOWN).map((r, i) => (
                    <div key={i} className="flex flex-wrap items-baseline gap-x-3 border-b border-border/40 px-3 py-1.5 last:border-0" role="listitem">
                      <span className="text-primary">{formatHexOffset(r.start)}</span>
                      <span className="text-muted-foreground">
                        {r.bytes === 1 ? '1 Byte' : `${r.bytes} Bytes`} (Bank {bankOf(r.start)})
                      </span>
                      <span className="min-w-0 break-all">
                        <span className="text-muted-foreground line-through">{hexPreview(slotA.data, r.start, r.end)}</span>
                        <span className="mx-1">→</span>
                        <span className="text-success">{hexPreview(slotB.data, r.start, r.end)}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
