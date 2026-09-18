'use client';

import { useState } from 'react';
import { Terminal, Trash2, Copy, ArrowDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher } from '@/store/flasher';
import type { LogDir } from '@/lib/kwp/types';
import { cn } from '@/lib/utils';

const DIR_STYLE: Record<LogDir, { label: string; cls: string }> = {
  tx: { label: 'TX', cls: 'bg-primary/15 text-primary' },
  rx: { label: 'RX', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  info: { label: 'INFO', cls: 'bg-muted text-muted-foreground' },
  error: { label: 'FEHLER', cls: 'bg-destructive/15 text-destructive' },
  ok: { label: 'OK', cls: 'bg-success/15 text-success' },
};

export function LogPanel() {
  const logs = useFlasher((s) => s.logs);
  const clearLogs = useFlasher((s) => s.clearLogs);
  const [filter, setFilter] = useState<'all' | LogDir>('all');

  const visible = filter === 'all' ? logs : logs.filter((l) => l.dir === filter);

  function copyAll() {
    const text = logs
      .map(
        (l) =>
          `${new Date(l.ts).toISOString()} [${l.dir.toUpperCase()}] ${l.message}${l.hex ? ` | ${l.hex}` : ''}`
      )
      .join('\n');
    void navigator.clipboard.writeText(text);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" aria-hidden />
            Protokoll
          </CardTitle>
          <CardDescription>
            Rohdaten-Log aller KWP2000-Frames (max. 600 Einträge, neueste zuerst).
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copyAll} disabled={logs.length === 0}>
            <Copy /> Kopieren
          </Button>
          <Button size="sm" variant="ghost" onClick={clearLogs} disabled={logs.length === 0}>
            <Trash2 /> Leeren
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Log-Filter">
          {(['all', 'tx', 'rx', 'info', 'error', 'ok'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                filter === f
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {f === 'all' ? 'Alle' : DIR_STYLE[f].label}
            </button>
          ))}
        </div>

        <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/20 p-2 font-mono text-xs custom-scrollbar" aria-live="polite">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Noch keine Einträge – verbinden und diagnosieren.
            </p>
          ) : (
            visible.map((l) => {
              const style = DIR_STYLE[l.dir];
              return (
                <div key={l.id} className="border-b border-border/40 py-1.5 last:border-0">
                  <div className="flex items-start gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', style.cls)}>{style.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(l.ts).toLocaleTimeString('de-DE', { hour12: false })}
                    </span>
                    <span className="min-w-0 break-all">{l.message}</span>
                  </div>
                  {l.hex && (
                    <p className="mt-0.5 break-all pl-1 text-[10px] text-muted-foreground">{l.hex}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          Neueste oben · K-Line-Echos werden automatisch verworfen
          <Badge variant="outline" className="ml-auto">
            {logs.length} Einträge
          </Badge>
        </div>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Tipp: Bei Störungen den FEHLER-Filter nutzen – Prüfsummenfehler und Timeouts deuten auf Kabelbruch,
          schlechte Masse oder Zündung aus.
        </p>
      </CardFooter>
    </Card>
  );
}
