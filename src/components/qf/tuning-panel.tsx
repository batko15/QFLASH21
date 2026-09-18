'use client';

import { useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Circle,
  CloudSun,
  Download,
  Flame,
  Link2,
  ListChecks,
  Smartphone,
  Target,
  TriangleAlert,
  BookOpen,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  CLIMATE_GELIBOLU,
  CLIMATE_NOTE,
  DTC_TUNING_NOTES,
  ENGINE,
  HARDWARE_LIMITS,
  LIMITER_CHAIN,
  REFERENCES,
  STAGE1,
  WORKFLOW_STEPS,
  calcAfr,
  fmt,
  iqToNm,
  mgToMm3,
  mm3ToMg,
  nmToIq,
  svblRange,
} from '@/lib/edc15-knowledge';

/** Tuning-Wissen: EDC15C4/DDE 4.0 Kalibrierungs-Referenz (Stage 1, Limits, Rechner). */
export function TuningPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Stage1Card />
      <LimiterChainCard />
      <LimitsCard />
      <CalculatorsCard />
      <WorkflowCard />
      <ClimateCard />
      <AndroidAppCard />
      <SafetyCard />
    </div>
  );
}

/* ---------------- Stage-1-Ziel ---------------- */

function Stage1Card() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" aria-hidden />
          Stage-1-Ziel · {ENGINE.engine}
        </CardTitle>
        <CardDescription className="text-xs">{ENGINE.ecu} · {ENGINE.injection}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <MetricRow label="Leistung" from={`${ENGINE.serial.ps} PS`} to={`${STAGE1.ps} PS`} />
          <MetricRow label="Drehmoment" from={`${ENGINE.serial.nm} Nm`} to={`${STAGE1.nm} Nm`} />
          <MetricRow
            label="Einspritzmenge"
            from={`${ENGINE.serialIqMg} mg/Hub`}
            to={`${STAGE1.iqMgRange[0]}–${STAGE1.iqMgRange[1]} mg/Hub`}
          />
          <MetricRow label="mm³ (≈)" from={`${ENGINE.serialIqMm3} mm³`} to={`${STAGE1.iqMm3} mm³`} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{STAGE1.note}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-[10px]">{ENGINE.turbo}</Badge>
          <Badge variant="secondary" className="text-[10px]">{ENGINE.vehicles}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-sm">
        <span className="text-muted-foreground line-through decoration-muted-foreground/40">{from}</span>
        <span className="text-primary">→</span>
        <span className="font-bold">{to}</span>
      </p>
    </div>
  );
}

/* ---------------- Limiter-Kette ---------------- */

function LimiterChainCard() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="h-4 w-4 text-primary" aria-hidden />
          Limiter-Kette: IQ_final = min(…)
        </CardTitle>
        <CardDescription className="text-xs">
          Das Steuergerät wählt pro Hub die KLEINSTE Menge aus allen Begrenzern.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        {LIMITER_CHAIN.map((l, i) => (
          <div key={l.id} className="relative rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {i + 1}
              </span>
              <p className="text-sm font-semibold">{l.label}</p>
            </div>
            <p className="mt-1 pl-8 font-mono text-[10px] text-primary/90">{l.map}</p>
            <p className="mt-1 pl-8 text-xs leading-relaxed text-muted-foreground">{l.detail}</p>
          </div>
        ))}
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 font-mono text-[11px] text-warning">
          IQ_final = min(IQ_driver, IQ_torque, IQ_smoke)
        </p>
      </CardContent>
    </Card>
  );
}

/* ---------------- Hardware-Limits ---------------- */

function LimitsCard() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden />
          Hardware-Grenzwerte (Guardrails)
        </CardTitle>
        <CardDescription className="text-xs">
          Harte physikalische Limits – Überschreitung zerstört Hardware oder setzt den Motor in Notlauf.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
          {HARDWARE_LIMITS.map((l) => (
            <div
              key={l.id}
              className={cn(
                'rounded-lg border p-3',
                l.severity === 'critical' ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5'
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{l.title}</p>
                <Badge variant={l.severity === 'critical' ? 'destructive' : 'warning'} className="text-[10px]">
                  {l.limit}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{l.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Kalkulatoren ---------------- */

function CalculatorsCard() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4 text-primary" aria-hidden />
          Kalibrier-Rechner
        </CardTitle>
        <CardDescription className="text-xs">
          Validierungsformeln aus der EDC15C4-Referenz (alle Werte je Hub).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        <AfrCalc />
        <Separator />
        <SvblCalc />
        <Separator />
        <IqMm3Calc />
        <Separator />
        <IqNmCalc />
      </CardContent>
    </Card>
  );
}

function AfrCalc() {
  const [maf, setMaf] = useState('950');
  const [iq, setIq] = useState('58');
  const afr = useMemo(() => calcAfr(Number(maf), Number(iq)), [maf, iq]);
  const ok = afr !== null && afr >= 16;
  return (
    <div>
      <Label className="text-xs font-semibold">
        Rauchbegrenzung: AFR = MAF / IQ <span className="text-muted-foreground">(mg/Hub)</span>
      </Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <Input inputMode="decimal" type="number" min={0} value={maf} onChange={(e) => setMaf(e.target.value)} aria-label="Luftmasse in mg pro Hub" />
          <p className="mt-1 text-[10px] text-muted-foreground">MAF (mg/Hub)</p>
        </div>
        <div>
          <Input inputMode="decimal" type="number" min={0} value={iq} onChange={(e) => setIq(e.target.value)} aria-label="Einspritzmenge in mg pro Hub" />
          <p className="mt-1 text-[10px] text-muted-foreground">IQ (mg/Hub)</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">AFR / Lambda</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold">{fmt(afr, 2)}</span>
          {afr !== null && (
            <Badge variant={ok ? 'success' : 'destructive'} className="text-[10px]">
              {ok ? 'mager ok (λ ≥ 1,1)' : `Ruß! (λ = ${fmt(afr / 14.6, 2)})`}
            </Badge>
          )}
        </span>
      </div>
    </div>
  );
}

function SvblCalc() {
  const [boost, setBoost] = useState('2300');
  const range = useMemo(() => svblRange(Number(boost)), [boost]);
  return (
    <div>
      <Label htmlFor="svbl-in" className="text-xs font-semibold">
        SVBL – Single Value Boost Limiter
      </Label>
      <div className="mt-2">
        <Input
          id="svbl-in"
          inputMode="decimal"
          type="number"
          min={0}
          value={boost}
          onChange={(e) => setBoost(e.target.value)}
          aria-label="Höchster Ladedruck-Sollwert in mbar absolut"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">Höchster Ladedruck-Sollwert (mbar, absolut)</p>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">SVBL = Boost-Max + 100…150 mbar</span>
        <span className="font-mono text-sm font-bold text-primary">
          {range ? `${range[0]}–${range[1]} mbar` : '–'}
        </span>
      </div>
    </div>
  );
}

function IqMm3Calc() {
  const [mm3, setMm3] = useState('69');
  const [mg, setMg] = useState('58');
  return (
    <div>
      <Label className="text-xs font-semibold">Umrechnung mm³ ↔ mg/Hub (ρ ≈ 0,84 g/cm³)</Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <Input
            inputMode="decimal"
            type="number"
            min={0}
            value={mm3}
            onChange={(e) => setMm3(e.target.value)}
            aria-label="Einspritzmenge in Kubikmillimeter"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {fmt(mm3ToMg(Number(mm3)), 1)} mg/Hub
          </p>
        </div>
        <div>
          <Input
            inputMode="decimal"
            type="number"
            min={0}
            value={mg}
            onChange={(e) => setMg(e.target.value)}
            aria-label="Einspritzmenge in Milligramm"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {fmt(mgToMm3(Number(mg)), 1)} mm³
          </p>
        </div>
      </div>
    </div>
  );
}

function IqNmCalc() {
  const [iq, setIq] = useState('71.5');
  const [nm, setNm] = useState('480');
  return (
    <div>
      <Label className="text-xs font-semibold">IQ ↔ Drehmoment (Näherung, ±10 %)</Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <Input
            inputMode="decimal"
            type="number"
            min={0}
            value={iq}
            onChange={(e) => setIq(e.target.value)}
            aria-label="Einspritzmenge für Drehmoment-Schätzung"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">{fmt(iqToNm(Number(iq)), 0)} Nm (ca.)</p>
        </div>
        <div>
          <Input
            inputMode="decimal"
            type="number"
            min={0}
            value={nm}
            onChange={(e) => setNm(e.target.value)}
            aria-label="Drehmoment für Einspritzmengen-Schätzung"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">{fmt(nmToIq(Number(nm)), 1)} mg/Hub (ca.)</p>
        </div>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        Lineare Näherung durch die Referenzpunkte 58 mg → 390 Nm und 71,5 mg → 480 Nm (M57D30).
      </p>
    </div>
  );
}

/* ---------------- Workflow-Checkliste ---------------- */

function WorkflowCard() {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allDone = done.size === WORKFLOW_STEPS.length;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden />
          Stage-1-Workflow
        </CardTitle>
        <CardDescription className="text-xs">
          Chronologische Abfolge (Human-in-the-Loop) aus dem KI-Kalibrierungs-Prompt.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <ol className="space-y-2">
          {WORKFLOW_STEPS.map((s) => {
            const isDone = done.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={isDone}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border p-3 text-left transition-colors min-h-[44px]',
                    isDone ? 'border-success/40 bg-success/5' : 'bg-muted/30 hover:bg-muted/60'
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span>
                    <span className={cn('block text-sm font-semibold', isDone && 'line-through decoration-success/50')}>
                      Schritt {s.id}: {s.title}
                    </span>
                    <span className="mt-1 block space-y-1">
                      {s.items.map((it, j) => (
                        <span key={j} className="block text-xs leading-relaxed text-muted-foreground">
                          • {it}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {allDone && (
          <p className="mt-2 rounded-lg border border-success/40 bg-success/10 p-2.5 text-xs text-success">
            Workflow abgeschlossen – Schreiben nur mit Backup + bestätigter Prüfsummenkorrektur!
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Klima ---------------- */

function ClimateCard() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudSun className="h-4 w-4 text-primary" aria-hidden />
          Referenzklima Gelibolu, Çanakkale (TR)
        </CardTitle>
        <CardDescription className="text-xs">Umgebungsmodelle für die Kalibrierung.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Monat</th>
                <th className="px-3 py-2">Luftdruck (mbar)</th>
                <th className="px-3 py-2">Feuchte</th>
                <th className="px-3 py-2">Niederschlag</th>
              </tr>
            </thead>
            <tbody>
              {CLIMATE_GELIBOLU.map((c) => (
                <tr key={c.month} className="border-t">
                  <td className="px-3 py-2 font-medium">{c.month}</td>
                  <td className="px-3 py-2 font-mono">{fmt(c.mbar, 1)}</td>
                  <td className="px-3 py-2">{c.humidity}</td>
                  <td className="px-3 py-2">{c.rain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{CLIMATE_NOTE}</p>
      </CardContent>
    </Card>
  );
}

/* ---------------- Android-APK ---------------- */

function AndroidAppCard() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4 text-primary" aria-hidden />
          Android-App v1.2.0 (TWA)
        </CardTitle>
        <CardDescription className="text-xs">
          Echte App: fullscreen in Chrome (Web Serial verfügbar), kein URL-Balken.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <Button asChild className="w-full min-h-[44px]">
          <a href="/apk/QFLASH21-v1.2.0.apk" download>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            QFLASH21-v1.2.0.apk (arm64/alle ABIs, ~2,6 MB)
          </a>
        </Button>
        <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">1.</span> Alte QFLASH21-App <b className="text-foreground">deinstallieren</b> (neue Signatur – Update-Installation sonst blockiert).
          </li>
          <li>
            <span className="font-semibold text-foreground">2.</span> APK herunterladen und in der Dateiverwaltung öffnen.
          </li>
          <li>
            <span className="font-semibold text-foreground">3.</span> „Aus dieser Quelle installieren“ für Chrome/Dateimanager erlauben.
          </li>
          <li>
            <span className="font-semibold text-foreground">4.</span> <b className="text-foreground">MagicOS (Honor/Huawei):</b> „Reiner Modus“ (Pure Mode) ggf. in den Einstellungen deaktivieren – er blockiert Sideloads.
          </li>
          <li>
            <span className="font-semibold text-foreground">5.</span> Play-Protect-Hinweis: „Trotzdem installieren“ wählen (Signatur: selbst signiert, Open Source).
          </li>
          <li>
            <span className="font-semibold text-foreground">6.</span> <b className="text-foreground">Chrome muss installiert sein</b> – die App rendert über Chrome (Web Serial). Ohne Chrome öffnet sich die Seite im Standard-Browser (dann keine Diagnose!).
          </li>
          <li>
            <span className="font-semibold text-foreground">7.</span> Icon „QFLASH21“ antippen → App öffnet sich fullscreen.
          </li>
        </ol>
        <p className="rounded-lg border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Alternative PWA:</b> In Chrome qflashk.vercel.app öffnen → Menü → „App installieren“.
          Gleiche Funktion, ohne APK – ebenfalls Web-Serial-fähig.
        </p>
      </CardContent>
    </Card>
  );
}

/* ---------------- Sicherheit & Quellen ---------------- */

function SafetyCard() {
  return (
    <Card className="border-destructive/40">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-destructive" aria-hidden />
          Zero-Trust-Warnung & Quellen
        </CardTitle>
        <CardDescription className="text-xs">
          Firmware-Modifikation ist Hochrisiko – Prüfsummenkorrektur ist Pflicht.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs leading-relaxed">
            <TriangleAlert className="mr-1 inline h-3.5 w-3.5 text-destructive" aria-hidden />
            <b>Schreiben ohne korrigierte EDC15-Prüfsumme zerstört das Steuergerät („Bricking“).</b> Jede
            Binäränderung erfordert die Prüfsummenkorrektur (16-KiB-Bänke, 2×16-Bit-Summenwörter – siehe
            Tab „Prüfsumme“) und ein vollständiges Backup vorher. Human-in-the-Loop: Jeder Schreibvorgang
            braucht eine explizite Bestätigung.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold">Referenzen (Deepweb/GitHub-Recherche):</p>
          <ul className="mt-1.5 space-y-1">
            {REFERENCES.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Link2 className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{r.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold">Tuning-relevante Fehlernummern:</p>
          {Object.entries(DTC_TUNING_NOTES).map(([code, note]) => (
            <div key={code} className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Badge variant="destructive" className="mt-0.5 shrink-0 text-[10px]">
                {code.padStart(5, '0')}
              </Badge>
              <span>{note}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
