'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Terminal,
  Trash2,
  Copy,
  ArrowDown,
  History,
  RefreshCw,
  Database,
  Plug,
  Fingerprint,
  ScanSearch,
  Eraser,
  HardDriveDownload,
  HardDriveUpload,
  Wrench,
  RotateCcw,
  FileText,
  CircleAlert,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher } from '@/store/flasher';
import { fetchOperationLogSupabase, type OperationLogEntry } from '@/lib/supabase-log';
import type { LogDir } from '@/lib/kwp/types';
import { cn } from '@/lib/utils';

/** Deutsche Klarnamen + Icons für die Operationshistorie (Datenbank-Operationen). */
const OPERATION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  CONNECT: { label: 'Verbindung', icon: Plug },
  READ_IDENT: { label: 'Identifikation', icon: Fingerprint },
  READ_DTC: { label: 'Fehlerspeicher lesen', icon: ScanSearch },
  CLEAR_DTC: { label: 'Fehlerspeicher gelöscht', icon: Eraser },
  READ_FLASH: { label: 'Flash gelesen', icon: HardDriveDownload },
  WRITE_FLASH: { label: 'Flash geschrieben', icon: HardDriveUpload },
  ERASE_FLASH: { label: 'Flash gelöscht', icon: Trash2 },
  JOB_ECU_RESET: { label: 'Steuergerät-Reset', icon: RotateCcw },
  JOB_OUTPUT: { label: 'Aktuatorik-Test', icon: Wrench },
  JOB_ROUTINE: { label: 'Routine', icon: Wrench },
  JOB_READ: { label: 'Info-Auslesung', icon: FileText },
};

/** Kurzbeschreibung aus den JSON-Details der Operation. */
function describeDetails(operation: string, raw: string | null): string | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (operation === 'CLEAR_DTC' && typeof d.cleared === 'number') {
      return `${d.cleared} Einträge entfernt (normal: ${d.normal ?? 0}, Schatten: ${d.shadow ?? 0})`;
    }
    if (operation === 'READ_DTC') {
      const n = d.normal ?? d.cleared;
      if (typeof n === 'number') return `Normal: ${n} · Schatten: ${d.shadow ?? 0}`;
    }
    if (operation === 'CONNECT' && typeof d.port === 'string') return `Port: ${d.port}`;
    if (operation === 'READ_IDENT' && typeof d.ecuType === 'string') return d.ecuType;
    if (operation === 'READ_FLASH') return `${d.size ?? '?'} Bytes gelesen`;
    if (operation === 'WRITE_FLASH') return `${d.size ?? '?'} Bytes · ${d.label ?? 'Image'}`;
    if (typeof d.job === 'string') return `Job: ${d.job}`;
    return null;
  } catch {
    return null;
  }
}

const DIR_STYLE: Record<LogDir, { label: string; cls: string }> = {
  tx: { label: 'TX', cls: 'bg-primary/15 text-primary' },
  rx: { label: 'RX', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  info: { label: 'INFO', cls: 'bg-muted text-muted-foreground' },
  error: { label: 'FEHLER', cls: 'bg-destructive/15 text-destructive' },
  ok: { label: 'OK', cls: 'bg-success/15 text-success' },
};

/** Holt die Historie: zuerst Server-API, bei Fehlern Supabase-REST direkt. */
async function fetchHistory(): Promise<{ rows: OperationLogEntry[]; source: 'server' | 'supabase' }> {
  try {
    const res = await fetch('/api/logs?limit=25');
    if (res.ok) {
      const data = (await res.json()) as { logs: OperationLogEntry[] };
      return { rows: data.logs, source: 'server' };
    }
  } catch {
    // → Fallback
  }
  const rows = await fetchOperationLogSupabase(25);
  return { rows, source: 'supabase' };
}

export function LogPanel() {
  const logs = useFlasher((s) => s.logs);
  const clearLogs = useFlasher((s) => s.clearLogs);
  const [filter, setFilter] = useState<'all' | LogDir>('all');

  // ── Operationshistorie (Supabase, Server-API mit REST-Fallback) ──
  const [history, setHistory] = useState<OperationLogEntry[] | null>(null);
  const [historySource, setHistorySource] = useState<'server' | 'supabase' | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const applyHistory = (r: { rows: OperationLogEntry[]; source: 'server' | 'supabase' }) => {
    setHistory(r.rows);
    setHistorySource(r.source);
    setHistoryError(null);
  };

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError(null);
    fetchHistory()
      .then(applyHistory)
      .catch(() => setHistoryError('Datenbank nicht erreichbar'))
      .finally(() => setHistoryLoading(false));
  }, []);

  // Initial laden – asynchron, ohne synchrones setState im Effect (React-Regeln)
  useEffect(() => {
    let cancelled = false;
    fetchHistory()
      .then((r) => {
        if (!cancelled) applyHistory(r);
      })
      .catch(() => {
        if (!cancelled) setHistoryError('Datenbank nicht erreichbar');
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

        {/* ── Operationshistorie (dauerhaft in Supabase) ── */}
        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-semibold">Operationshistorie</p>
            {historySource && (
              <Badge variant="outline" className="gap-1">
                <Database className="h-3 w-3" aria-hidden />
                {historySource === 'server' ? 'Server-API' : 'Supabase direkt'}
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2"
              onClick={() => void loadHistory()}
              disabled={historyLoading}
              aria-label="Operationshistorie neu laden"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', historyLoading && 'animate-spin')} />
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Dauerhaft gespeicherte Aktionen (Verbinden, Ident, Fehlerspeicher, Flash …) aus der Supabase-Datenbank.
          </p>
          <div className="mt-2 max-h-56 overflow-y-auto custom-scrollbar">
            {historyError ? (
              <p className="py-3 text-center text-xs text-muted-foreground">{historyError}</p>
            ) : history === null ? (
              <p className="py-3 text-center text-xs text-muted-foreground">Lade Historie …</p>
            ) : history.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                Noch keine Operationen gespeichert – nach dem ersten Diagnoselauf erscheinen sie hier.
              </p>
            ) : (
              <ul className="divide-y divide-border/40 text-xs">
                {history.map((h) => {
                  const meta = OPERATION_META[h.operation];
                  const OpIcon = meta?.icon ?? CircleAlert;
                  const detail = describeDetails(h.operation, h.details);
                  return (
                    <li key={h.id} className="py-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Badge variant={h.status === 'ERROR' ? 'destructive' : 'success'} className="px-1.5 py-0 text-[10px]">
                          {h.status}
                        </Badge>
                        <OpIcon className={cn('h-3.5 w-3.5', h.operation === 'CLEAR_DTC' ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
                        <span className={cn('font-medium', h.operation === 'CLEAR_DTC' && 'text-warning')}>
                          {meta?.label ?? h.operation}
                        </span>
                        {h.vehicle && <span className="text-muted-foreground">· {h.vehicle}</span>}
                        {typeof h.durationMs === 'number' && (
                          <span className="text-muted-foreground">· {h.durationMs} ms</span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {new Date(h.createdAt).toLocaleString('de-DE', { hour12: false })}
                        </span>
                      </div>
                      {detail && (
                        <p className="mt-0.5 pl-[4.75rem] text-[10px] text-muted-foreground">{detail}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
