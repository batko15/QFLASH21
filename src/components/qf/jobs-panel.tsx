'use client';

import { useMemo, useState } from 'react';
import {
  Wrench,
  Power,
  RotateCcw,
  SlidersHorizontal,
  ScanSearch,
  TriangleAlert,
  CircleCheck,
  CircleX,
  Info,
  Loader2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFlasher, type JobResult } from '@/store/flasher';
import { JOBS, type EcuJob } from '@/lib/kwp/dde4';
import { cn } from '@/lib/utils';

const KIND_META: Record<
  EcuJob['kind'],
  { label: string; icon: React.ReactNode; group: string }
> = {
  reset: { label: 'Reset', icon: <RotateCcw className="h-3.5 w-3.5" />, group: 'Steuergerät' },
  routine: { label: 'Routine', icon: <SlidersHorizontal className="h-3.5 w-3.5" />, group: 'Routinen (0x31)' },
  output: { label: 'Ausgang', icon: <Power className="h-3.5 w-3.5" />, group: 'Aktuatorik (0x30)' },
  read: { label: 'Lesen', icon: <ScanSearch className="h-3.5 w-3.5" />, group: 'Info-Felder (0x1A)' },
};

const DANGER_STYLE: Record<EcuJob['danger'], string> = {
  safe: 'border-success/40 hover:bg-success/5',
  caution: 'border-warning/40 hover:bg-warning/5',
  danger: 'border-destructive/40 hover:bg-destructive/5',
};

export function JobsPanel() {
  const connected = useFlasher((s) => s.connection === 'connected');
  const busy = useFlasher((s) => s.busy);
  const jobRunning = useFlasher((s) => s.jobRunning);
  const jobResult = useFlasher((s) => s.jobResult);
  const jobHistory = useFlasher((s) => s.jobHistory);
  const runJob = useFlasher((s) => s.runJob);
  const scanLids = useFlasher((s) => s.scanLids);
  const lidScan = useFlasher((s) => s.lidScan);
  const lidScanning = useFlasher((s) => s.lidScanning);
  const isMock = useFlasher((s) => s.isMock);

  const [confirmJob, setConfirmJob] = useState<EcuJob | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, EcuJob[]>();
    for (const job of JOBS) {
      const g = KIND_META[job.kind].group;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(job);
    }
    return Array.from(map.entries());
  }, []);

  function request(job: EcuJob) {
    if (job.danger === 'safe') {
      void runJob(job);
    } else {
      setConfirmJob(job);
    }
  }

  return (
    <div className="space-y-4">
      {/* Sicherheits-Hinweis */}
      <Card className="border-warning/50 bg-warning/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="h-5 w-5 text-warning" aria-hidden />
            Sicherheits-Hinweise für Steuergeräte-Jobs
          </CardTitle>
          <CardDescription>
            Diese Jobs steuern direkt Komponenten am Motor. DeepOBD-Prinzip: freie Jobs, volle
            Verantwortung beim Anwender.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
          <p>· Fahrzeug auf fester Unterfläche, Gangneutral/P, Handbremse.</p>
          <p>· Aktuatorik-Tests: Zündung an, Motor aus (außer explizit anders).</p>
          <p>· Batteriespannung ≥ 12 V (Anzeige im Live-Block 0x07).</p>
          <p>· Reset: Motor aus, danach baut QFLASH21 die Session neu auf.</p>
        </CardContent>
      </Card>

      {/* Resultat der letzten Ausführung */}
      {jobResult && <JobResultCard result={jobResult} />}

      {/* Job-Gruppen */}
      {groups.map(([group, jobs]) => (
        <Card key={group}>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">{group}</CardTitle>
            <Badge variant="outline">{jobs.length} Jobs</Badge>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {jobs.map((job) => {
              const running = jobRunning === job.id;
              return (
                <div
                  key={job.id}
                  className={cn(
                    'flex flex-col rounded-xl border bg-card p-4 transition-colors',
                    DANGER_STYLE[job.danger]
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{job.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{job.desc}</p>
                    </div>
                    <Badge
                      variant={job.danger === 'danger' ? 'destructive' : job.danger === 'caution' ? 'warning' : 'success'}
                      className="shrink-0"
                    >
                      {KIND_META[job.kind].icon}
                      <span className="ml-1">{KIND_META[job.kind].label}</span>
                    </Badge>
                  </div>
                  <p className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {job.note}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3 w-fit"
                    variant={job.danger === 'danger' ? 'destructive' : 'default'}
                    disabled={!connected || busy}
                    onClick={() => request(job)}
                  >
                    {running ? <Loader2 className="animate-spin" /> : <Wrench />}
                    {running ? 'Läuft …' : 'Ausführen'}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/* LID-Scan (Bosch EDC15C: 16 applizierbare Messwertblöcke) */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Messwertblock-Scan (LID 0x20–0x2F)</CardTitle>
            <CardDescription>
              Liest die 16 Bosch-Standard-Messwertblöcke (je 10 Wörter). Die Zuordnung ist
              SW-variantenspezifisch – Roh-Werte zur Plausibilisierung gegen die Live-Daten.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void scanLids()}
            disabled={!connected || busy || lidScanning}
          >
            {lidScanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            {lidScanning ? 'Scanne …' : 'Scan starten'}
          </Button>
        </CardHeader>
        {lidScan && lidScan.length > 0 && (
          <CardContent>
            <div className="max-h-64 overflow-y-auto custom-scrollbar rounded-lg border">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-3 py-1.5 font-semibold">LID</th>
                    <th className="px-3 py-1.5 font-semibold">Messwert-Wörter (HEX, 10×16 Bit)</th>
                  </tr>
                </thead>
                <tbody>
                  {lidScan.map((r) => (
                    <tr key={r.lid} className="border-t">
                      <td className="px-3 py-1.5 font-bold">0x{r.lid.toString(16).toUpperCase()}</td>
                      <td className="px-3 py-1.5 break-all text-muted-foreground">{r.words.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Historie */}
      {jobHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Job-Historie (letzte {jobHistory.length})</CardTitle>
            <CardDescription>Maximal 12 Einträge, inkl. Fehlermeldungen.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-2 custom-scrollbar" aria-label="Job-Historie">
              {jobHistory.map((r, i) => (
                <li key={`${r.jobId}-${r.at}-${i}`} className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
                  {r.ok ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.text}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {new Date(r.at).toLocaleTimeString('de-DE')}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!isMock && (
        <p className="text-xs text-muted-foreground">
          Hinweis: Aktuatorik-IDs und Routine-IDs sind nach EDC15/DDE4-Konvention implementiert und
          gegen den virtuellen EDC15C4 verifiziert. Am echten Steuergerät erst mit geprüften
          Referenzen freischalten.
        </p>
      )}

      {/* Bestätigungs-Dialog für gefährliche Jobs */}
      <Dialog open={confirmJob !== null} onOpenChange={(open) => !open && setConfirmJob(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden />
              Job bestätigen
            </DialogTitle>
            <DialogDescription>
              {confirmJob?.name} – {confirmJob?.note}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ich habe die Sicherheitsbedingungen geprüft: Fahrzeug steht, korrekter Betriebszustand
            für diesen Job.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmJob(null)}>
              Abbrechen
            </Button>
            <Button
              variant={confirmJob?.danger === 'danger' ? 'destructive' : 'default'}
              onClick={() => {
                if (confirmJob) void runJob(confirmJob);
                setConfirmJob(null);
              }}
            >
              <Wrench /> Jetzt ausführen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobResultCard({ result }: { result: JobResult }) {
  return (
    <Card className={cn(result.ok ? 'border-success/50' : 'border-destructive/50')}>
      <CardContent className="flex items-start gap-3 p-4">
        {result.ok ? (
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
        ) : (
          <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{result.name}</p>
          <p className="text-sm text-muted-foreground">{result.text}</p>
          {result.hex && (
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">Antwort: {result.hex}</p>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {new Date(result.at).toLocaleTimeString('de-DE')}
        </span>
      </CardContent>
    </Card>
  );
}
