'use client';

import { useState } from 'react';
import { Gauge, Play, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher, getLiveBlocksMeta } from '@/store/flasher';
import { cn } from '@/lib/utils';

const BLOCKS = getLiveBlocksMeta();

function valueTone(v: { label: string; value: number; unit: string }): string {
  if (v.unit === 'V' && v.value < 12.0) return 'text-destructive';
  if (v.unit === 'V' && v.value >= 13.5) return 'text-success';
  if (v.label === 'Motordrehzahl' && v.value > 4500) return 'text-warning';
  return 'text-foreground';
}

export function LivePanel() {
  const connected = useFlasher((s) => s.connection === 'connected');
  const busy = useFlasher((s) => s.busy);
  const livePolling = useFlasher((s) => s.livePolling);
  const liveFrames = useFlasher((s) => s.liveFrames);
  const startLivePoll = useFlasher((s) => s.startLivePoll);
  const stopLivePoll = useFlasher((s) => s.stopLivePoll);

  const [blockId, setBlockId] = useState<number>(BLOCKS[0]?.id ?? 3);

  const frame = liveFrames[blockId];
  const lastTs = frame ? new Date(frame.timestamp).toLocaleTimeString('de-DE') : null;

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
              Service 0x21 (ReadDataByLocalIdentifier), Abfrage alle 600 ms.
            </CardDescription>
          </div>
          {livePolling ? (
            <Button size="sm" variant="destructive" onClick={stopLivePoll}>
              <Square /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => startLivePoll(blockId)} disabled={!connected || busy}>
              <Play /> Start
            </Button>
          )}
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
              {frame.values.map((v) => (
                <div key={v.label} className="rounded-xl border bg-card p-4 shadow-sm">
                  <p className="text-xs text-muted-foreground">{v.label}</p>
                  <p className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', valueTone(v))}>
                    {v.value.toFixed(v.decimals)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">{v.unit}</span>
                  </p>
                </div>
              ))}
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
              <span>K-Line-Polling – bei Störungen kurz stoppen und neu starten.</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
