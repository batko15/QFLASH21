'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  ScanSearch,
  Trash2,
  Download,
  Sparkles,
  AlertTriangle,
  EyeOff,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFlasher, VEHICLES } from '@/store/flasher';
import type { DtcEntry } from '@/lib/kwp/types';

function exportTxt(normal: DtcEntry[], shadow: DtcEntry[], vehicle: string): string {
  const lines: string[] = [
    'QFLASH21 – Fehlerspeicher-Bericht',
    `Fahrzeug: BMW ${VEHICLES.find((v) => v.id === vehicle)?.label ?? vehicle}`,
    `Datum: ${new Date().toLocaleString('de-DE')}`,
    '',
    `--- Fehlerspeicher (normal): ${normal.length} Einträge ---`,
    ...normal.map(
      (d) => `${d.code} | ${d.description} | Status 0x${d.status.toString(16).padStart(2, '0')} (${d.statusText})${d.sporadic ? ' | sporadisch' : ''}`
    ),
    '',
    `--- Schattenspeicher: ${shadow.length} Einträge ---`,
    ...shadow.map((d) => `${d.code} | ${d.description} | Status 0x${d.status.toString(16).padStart(2, '0')} (${d.statusText})`),
  ];
  return lines.join('\n');
}

export function DtcPanel() {
  const dtcs = useFlasher((s) => s.dtcs);
  const shadowDtcs = useFlasher((s) => s.shadowDtcs);
  const dtcReadAt = useFlasher((s) => s.dtcReadAt);
  const connected = useFlasher((s) => s.connection === 'connected');
  const busy = useFlasher((s) => s.busy);
  const vehicle = useFlasher((s) => s.vehicle);
  const ident = useFlasher((s) => s.ident);
  const readDtc = useFlasher((s) => s.readDtc);
  const clearDtc = useFlasher((s) => s.clearDtc);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showShadow, setShowShadow] = useState(true);

  const total = dtcs.length + shadowDtcs.length;

  async function handleAnalyze() {
    if (total === 0) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch('/api/analyze-dtc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dtcs: [...dtcs, ...shadowDtcs].map((d) => ({
            code: d.code,
            description: d.description,
            statusText: d.statusText,
            sporadic: d.sporadic,
            shadow: d.shadow,
          })),
          vehicle,
          ecuType: ident?.ecuType ?? 'DDE4.0',
        }),
      });
      const json = await res.json();
      setAnalysis(json.analysis ?? 'Keine Analyse erhalten.');
      if (json.source === 'fallback') {
        toast.info('Offline-Hinweise angezeigt', { description: 'KI-Dienst nicht erreichbar.' });
      }
    } catch {
      toast.error('Analyse fehlgeschlagen');
    } finally {
      setAnalyzing(false);
    }
  }

  function handleExport() {
    const blob = new Blob([exportTxt(dtcs, shadowDtcs, vehicle)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fehlerspeicher_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="h-5 w-5 text-primary" aria-hidden />
              Fehlerspeicher
            </CardTitle>
            <CardDescription>
              Service 0x18 (lesen) und 0x14 (löschen). Normaler Speicher plus DDE4-Schattenspeicher (Gruppe 0xFD00).
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void readDtc()} disabled={!connected || busy}>
              <RefreshCw /> Lesen
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={!connected || busy || total === 0}
            >
              <Trash2 /> Löschen
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {dtcReadAt === null ? (
            <EmptyHint />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={dtcs.length === 0 ? 'success' : 'destructive'}>
                  Normal: {dtcs.length}
                </Badge>
                <Badge variant={shadowDtcs.length === 0 ? 'success' : 'warning'}>
                  Schatten: {shadowDtcs.length}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Gelesen: {new Date(dtcReadAt).toLocaleTimeString('de-DE')}
                </span>
              </div>

              <div className="max-h-96 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                {dtcs.length > 0 && (
                  <section aria-label="Normale Fehlerspeicher-Einträge">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Normaler Speicher
                    </h3>
                    <div className="space-y-2">
                      {dtcs.map((d) => (
                        <DtcRow key={`n-${d.code}`} dtc={d} />
                      ))}
                    </div>
                  </section>
                )}
                {dtcs.length === 0 && (
                  <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
                    <AlertTriangle className="h-4 w-4" aria-hidden /> Keine Einträge im normalen Fehlerspeicher.
                  </p>
                )}
                {shadowDtcs.length > 0 && showShadow && (
                  <section aria-label="Schattenspeicher-Einträge">
                    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Schattenspeicher (historisch)
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setShowShadow(false)}
                        aria-label="Schattenspeicher ausblenden"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </button>
                    </h3>
                    <div className="space-y-2">
                      {shadowDtcs.map((d) => (
                        <DtcRow key={`s-${d.code}`} dtc={d} />
                      ))}
                    </div>
                  </section>
                )}
                {shadowDtcs.length > 0 && !showShadow && (
                  <Button size="sm" variant="ghost" onClick={() => setShowShadow(true)}>
                    Schattenspeicher einblenden
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void handleAnalyze()} disabled={total === 0 || analyzing}>
            <Sparkles className={analyzing ? 'animate-pulse' : undefined} />
            {analyzing ? 'Analysiere …' : 'KI-Werkstattanalyse'}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={dtcReadAt === null}>
            <Download /> Bericht exportieren
          </Button>
        </CardFooter>
      </Card>

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Werkstattanalyse
            </CardTitle>
            <CardDescription>KI-generiert – keine Garantie, immer fachgerecht prüfen.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{analysis}</pre>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fehlerspeicher löschen?</DialogTitle>
            <DialogDescription>
              Alle {total} Einträge (normal + Schatten) werden im Steuergerät gelöscht. Historische
              Informationen gehen verloren. Vor dem Löschen Bericht exportieren!
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                void clearDtc();
              }}
              disabled={busy}
            >
              <Trash2 /> Jetzt löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DtcRow({ dtc }: { dtc: DtcEntry }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-sm font-bold">{dtc.code}</span>
        {dtc.sporadic && <Badge variant="warning">sporadisch</Badge>}
        {dtc.shadow && <Badge variant="outline">Schatten</Badge>}
        <Badge
          variant={dtc.priority === 'Hoch' ? 'destructive' : dtc.priority === 'Mittel' ? 'warning' : 'secondary'}
        >
          {dtc.priority}
        </Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          0x{dtc.raw.toString(16).toUpperCase().padStart(4, '0')} · Status 0x
          {dtc.status.toString(16).padStart(2, '0')}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium">{dtc.description}</p>
      <p className="text-xs text-muted-foreground">{dtc.statusText}</p>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <ScanSearch className="h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="max-w-sm text-sm text-muted-foreground">
        Noch kein Ausleselauf. „Lesen“ startet Service 0x18 für beide Speicherbereiche – funktioniert
        auch mit dem Simulator ohne Fahrzeug.
      </p>
    </div>
  );
}
