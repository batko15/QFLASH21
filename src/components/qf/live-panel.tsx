'use client';

import { useMemo, useState } from 'react';
import { Gauge, Play, Square, Circle, Download, Trash2, Activity } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher, getLiveBlocksMeta } from '@/store/flasher';
import type { LiveDataFrame, LiveValue } from '@/lib/kwp/types';
import { cn } from '@/lib/utils';

const BLOCKS = getLiveBlocksMeta();

/* ── Messbereiche für Gauge/Verlauf je Einheit ── */
interface Range {
  min: number;
  max: number;
  warnFrom?: number;
  warnTo?: number;
}
function rangeFor(v: LiveValue): Range {
  if (v.unit === '1/min' || v.label.toLowerCase().includes('drehzahl')) return { min: 0, max: 5500, warnFrom: 4500 };
  if (v.unit === '°C') return { min: -20, max: 120, warnFrom: 105 };
  if (v.unit === 'mbar') return { min: 800, max: 3000, warnFrom: 2500 };
  if (v.unit === 'V') return { min: 8, max: 16, warnFrom: 12 };
  if (v.unit === 'ms') return { min: 0, max: 8 };
  if (v.unit === '°KW' || v.unit === '°kW') return { min: -10, max: 15 };
  if (v.unit === 'mg/Hub' || v.unit === 'mg/h') return { min: 0, max: Math.max(50, v.value * 1.4) };
  return { min: 0, max: Math.max(1, v.value * 1.4) };
}
function warnActive(v: LiveValue, r: Range): boolean {
  if (r.warnFrom != null && v.value < r.warnFrom) return false;
  if (r.warnTo != null && v.value > r.warnTo) return false;
  return r.warnFrom != null || r.warnTo != null;
}

/* ── SVG-Kreuzzeiger-Gauge (240° Bogen) ── */
function GaugeDial({ v, compact = false }: { v: LiveValue; compact?: boolean }) {
  const r = rangeFor(v);
  const pct = Math.min(1, Math.max(0, (v.value - r.min) / (r.max - r.min)));
  const START = 150; // Grad
  const SWEEP = 240;
  const angle = START + pct * SWEEP;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const R = 42;
  const cx = 50;
  const cy = 50;
  const arc = (from: number, to: number, radius: number) => {
    const x1 = cx + radius * Math.cos(rad(from));
    const y1 = cy + radius * Math.sin(rad(from));
    const x2 = cx + radius * Math.cos(rad(to));
    const y2 = cy + radius * Math.sin(rad(to));
    const large = to - from > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };
  const warn = warnActive(v, r);
  const stroke = warn ? 'var(--destructive, #dc2626)' : 'var(--primary, #f59e0b)';
  const needleX = cx + (R - 8) * Math.cos(rad(angle));
  const needleY = cy + (R - 8) * Math.sin(rad(angle));

  return (
    <svg viewBox="0 0 100 78" className={cn('w-full', compact ? 'max-w-[130px]' : 'max-w-[190px]')} role="img" aria-label={`${v.label}: ${v.value} ${v.unit}`}>
      {/* Grundbogen */}
      <path d={arc(rad(START), rad(START + SWEEP), R)} fill="none" stroke="currentColor" className="text-muted-foreground/20" strokeWidth="7" strokeLinecap="round" />
      {/* Warnbereich */}
      {r.warnFrom != null && (() => {
        const wStart = START + ((r.warnFrom - r.min) / (r.max - r.min)) * SWEEP;
        return <path d={arc(rad(Math.max(START, wStart)), rad(START + SWEEP), R)} fill="none" stroke="currentColor" className="text-destructive/25" strokeWidth="7" strokeLinecap="round" />;
      })()}
      {/* Wertebogen */}
      {pct > 0.005 && (
        <path d={arc(rad(START), rad(angle), R)} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
      )}
      {/* Zeiger */}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="currentColor" className="text-foreground" strokeWidth="2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3.5" className="fill-foreground" />
      {/* Wert */}
      <text x={cx} y={cy + 20} textAnchor="middle" className="fill-foreground font-mono text-[13px] font-bold">
        {v.value.toFixed(v.decimals)}
      </text>
      <text x={cx} y={cy + 30} textAnchor="middle" className="fill-muted-foreground text-[7px]">
        {v.unit}
      </text>
    </svg>
  );
}

/* ── Sparkline (Verlauf) ── */
function Sparkline({ values, warn }: { values: number[]; warn: boolean }) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((val, i) => `${(i / (values.length - 1)) * 100},${28 - ((val - min) / span) * 24 - 2}`)
      .join(' ');
  }, [values]);

  if (!path) {
    return <p className="py-3 text-center text-[10px] text-muted-foreground">Sammle Messpunkte …</p>;
  }
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline
        points={path}
        fill="none"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        className={warn ? 'stroke-destructive' : 'stroke-primary'}
      />
    </svg>
  );
}

/* ── CSV-Export ── */
function buildCsv(frames: LiveDataFrame[]): string {
  const labels = frames[0]?.values.map((v) => v.label) ?? [];
  const head = ['zeitstempel', ...labels.map((l) => `${l} [${frames[0]?.values.find((v) => v.label === l)?.unit ?? ''}]`)];
  const rows = frames.map((f) => [
    new Date(f.timestamp).toISOString(),
    ...labels.map((l) => String(f.values.find((v) => v.label === l)?.value ?? '')),
  ]);
  return [head.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

function valueTone(v: LiveValue): string {
  if (v.unit === 'V' && v.value < 12.0) return 'text-destructive';
  if (v.unit === 'V' && v.value >= 13.5) return 'text-success';
  return 'text-foreground';
}

export function LivePanel() {
  const connected = useFlasher((s) => s.connection === 'connected');
  const busy = useFlasher((s) => s.busy);
  const livePolling = useFlasher((s) => s.livePolling);
  const liveFrames = useFlasher((s) => s.liveFrames);
  const liveHistory = useFlasher((s) => s.liveHistory);
  const recording = useFlasher((s) => s.recording);
  const recordedFrames = useFlasher((s) => s.recordedFrames);
  const startLivePoll = useFlasher((s) => s.startLivePoll);
  const stopLivePoll = useFlasher((s) => s.stopLivePoll);
  const startRecording = useFlasher((s) => s.startRecording);
  const stopRecording = useFlasher((s) => s.stopRecording);
  const clearRecording = useFlasher((s) => s.clearRecording);

  const [blockId, setBlockId] = useState<number>(BLOCKS[0]?.id ?? 3);

  const frame = liveFrames[blockId];
  const history = liveHistory[blockId] ?? [];
  const lastTs = frame ? new Date(frame.timestamp).toLocaleTimeString('de-DE') : null;

  function downloadCsv() {
    if (recordedFrames.length === 0) return;
    const blob = new Blob([buildCsv(recordedFrames)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qflash21-live-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" aria-hidden />
              Live-Daten
            </CardTitle>
            <CardDescription>
              Service 0x21 (ReadDataByLocalIdentifier), Abfrage alle 600 ms · KeepAlive pausiert beim Polling.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {livePolling ? (
              <Button size="sm" variant="destructive" onClick={stopLivePoll}>
                <Square /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => startLivePoll(blockId)} disabled={!connected || busy}>
                <Play /> Start
              </Button>
            )}
            {recording ? (
              <Button size="sm" variant="secondary" onClick={stopRecording}>
                <Circle className="fill-destructive text-destructive" /> Aufnahme stoppen
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={startRecording} disabled={!livePolling}>
                <Circle className="text-destructive" /> Aufzeichnen
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Messblöcke">
            {BLOCKS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={blockId === b.id}
                onClick={() => {
                  setBlockId(b.id);
                  if (livePolling) startLivePoll(b.id);
                }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  blockId === b.id
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'hover:bg-accent hover:text-accent-foreground'
                )}
              >
                0x{b.id.toString(16).toUpperCase().padStart(2, '0')} · {b.name.split(':')[0]}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {BLOCKS.find((b) => b.id === blockId)?.name}
            {lastTs && <> · letzte Aktualisierung {lastTs}</>}
          </p>

          {frame ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {frame.values.map((v) => {
                const r = rangeFor(v);
                const warn = warnActive(v, r);
                const series = history
                  .map((f) => f.values.find((x) => x.label === v.label)?.value)
                  .filter((x): x is number => typeof x === 'number');
                const gaugeFits = ['1/min', '°C', 'mbar', 'V'].includes(v.unit);
                return (
                  <div key={v.label} className={cn('rounded-xl border bg-card p-4 shadow-sm', warn && 'border-destructive/50')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{v.label}</p>
                      {warn && <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Grenzwert</Badge>}
                    </div>
                    {gaugeFits ? (
                      <div className="flex flex-col items-center">
                        <GaugeDial v={v} />
                        <Sparkline values={series} warn={warn} />
                      </div>
                    ) : (
                      <>
                        <p className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', valueTone(v))}>
                          {v.value.toFixed(v.decimals)}
                          <span className="ml-1 text-sm font-normal text-muted-foreground">{v.unit}</span>
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full transition-all', warn ? 'bg-destructive' : 'bg-primary')}
                            style={{ width: `${Math.min(100, Math.max(2, ((v.value - r.min) / (r.max - r.min)) * 100))}%` }}
                          />
                        </div>
                        <Sparkline values={series} warn={warn} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Gauge className="h-10 w-10 text-muted-foreground/40" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">
                {connected
                  ? '„Start" beginnt mit der Messwertabfrage.'
                  : 'Erst verbinden (Adapter oder Simulator), dann Live-Daten starten.'}
              </p>
            </div>
          )}

          {/* Aufzeichnung */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <Activity className={cn('h-4 w-4', recording ? 'animate-pulse text-destructive' : 'text-muted-foreground')} aria-hidden />
            <p className="text-sm font-medium">
              Aufzeichnung: {recordedFrames.length} Frame{recordedFrames.length === 1 ? '' : 's'}
              {recordedFrames.length >= 1500 && ' (Limit)'}
            </p>
            <span className="text-xs text-muted-foreground">· CSV mit Semikolon-Trennung (Excel-kompatibel)</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={recordedFrames.length === 0}>
                <Download /> CSV exportieren
              </Button>
              <Button size="sm" variant="ghost" onClick={clearRecording} disabled={recordedFrames.length === 0 || recording}>
                <Trash2 /> Leeren
              </Button>
            </div>
          </div>

          {frame && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Block 0x{blockId.toString(16).toUpperCase()}</Badge>
              {useFlasher.getState().lastVoltage != null && (
                <Badge
                  variant={
                    (useFlasher.getState().lastVoltage ?? 0) < 12 ? 'destructive' : 'success'
                  }
                >
                  Bordnetz: {useFlasher.getState().lastVoltage?.toFixed(1)} V
                </Badge>
              )}
              <span>Verlauf: letzte {Math.min(history.length, 120)} Messpunkte · bei Störungen kurz stoppen und neu starten.</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
