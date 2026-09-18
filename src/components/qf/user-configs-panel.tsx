'use client';

/**
 * Konfigs-Panel: Echte DDE4-Daten aus der persönlichen DeepOBD-Konfigsammlung
 * des Nutzers (MWB-Sets, Adaptions-Jobs, Fahrzeugkatalog, Fehler-ECU-Listen)
 * + Download der vollständigen Sammlung für DeepOBD am Telefon.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { saveKonfigsZipNatively } from '@/lib/kwp/native-api';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  Fuel,
  Gauge,
  Info,
  ShieldAlert,
  SlidersHorizontal,
  Stethoscope,
} from 'lucide-react';
import {
  DDE3_STATUS_JOBS,
  DDE4_ADAPTATION_JOBS,
  DDE4_ERROR_ECUS,
  DDE4_MWB_SETS,
  DDE4_THRESHOLDS,
  DDE4_USER_SOURCE_INFO,
  USER_CONFIG_CATALOG,
  type Dde4MwbSet,
} from '@/lib/kwp/dde4-user-configs';

const DANGER_META: Record<
  string,
  { label: string; className: string }
> = {
  safe: { label: 'nur lesen', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  caution: { label: 'verstellen', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  danger: { label: 'EEPROM-Write', className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30' },
};

/** Schlichter Alert-Block (shadcn-stil, ohne Radix-Abhängigkeit). */
function NoticeBlock({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'info' | 'warn' | 'danger';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    info: 'border-border bg-muted/40',
    warn: 'border-amber-500/40 bg-amber-500/5',
    danger: 'border-red-500/40 bg-red-500/5',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`} role="note">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="shrink-0">{icon}</span>
        {title}
      </p>
      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

function MwbFieldTable({ set }: { set: Dde4MwbSet }) {
  return (
    <div className="overflow-hidden rounded-lg border" aria-label={`MWB-Felder ${set.id}`}>
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-2 py-1.5 font-medium">Ergebnis (SGBD dde40kw0)</th>
            <th className="px-2 py-1.5 font-medium">Anzeige</th>
            <th className="px-2 py-1.5 text-right font-medium">Bereich</th>
          </tr>
        </thead>
        <tbody>
          {set.fields.map((f) => (
            <tr key={f.result} className="border-t">
              <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{f.result}</td>
              <td className="px-2 py-1.5">
                {f.label} <span className="text-muted-foreground">[{f.unit}]</span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-[10px]">
                {f.min} … {f.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThresholdList({
  title,
  rows,
}: {
  title: string;
  rows: readonly { max: number; color: string; note: string }[];
}) {
  return (
    <div className="rounded-lg border p-2">
      <p className="mb-1 text-xs font-semibold">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={`${title}-${r.max}-${r.note}`} className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border"
              style={{
                backgroundColor:
                  r.color === 'white'
                    ? '#ffffff'
                    : r.color === 'green'
                      ? '#22c55e'
                      : r.color === 'yellow'
                        ? '#eab308'
                        : r.color === 'orange'
                          ? '#f97316'
                          : r.color === 'red'
                            ? '#ef4444'
                            : r.color === 'blue'
                              ? '#3b82f6'
                              : '#71717a',
              }}
              aria-hidden
            />
            <span className="font-mono">{r.max === Infinity ? '>' : `≤ ${r.max}`}</span>
            <span className="text-muted-foreground">{r.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UserConfigsPanel() {
  const [downloaded, setDownloaded] = useState(false);

  return (
    <div className="space-y-4" role="region" aria-label="DDE4-Konfigurationen aus der Nutzer-Sammlung">
      {/* Download der Konfigsammlung */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileArchive className="h-4 w-4 text-primary" aria-hidden />
            Deine DeepOBD-Konfigsammlung (1434 Dateien)
          </CardTitle>
          <CardDescription>
            Die vollständige Sammlung (E38/E39/E46/E53/E6x, 9,6 MB) – direkt vom
            Telefon herunterladbar und in der App „Deep OBD für BMW und VAG“ nutzbar
            (Anleitung im Archiv).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button className="sm:w-auto">
            <a
              href="/downloads/DeepOBD-Konfigs-M57-M47.zip"
              download
              onClick={(e) => {
                // App-Modus: ZIP nativ aus der APK nach Downloads/ kopieren
                // (kein DownloadManager, kein Netz – die virtuelle App-Domain
                // wäre für den DownloadManager nicht auflösbar).
                if (saveKonfigsZipNatively('downloads/DeepOBD-Konfigs-M57-M47.zip',
                        'DeepOBD-Konfigs-M57-M47.zip')) {
                  e.preventDefault();
                }
                setDownloaded(true);
              }}
              className="flex items-center"
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              Konfigs-Zip herunterladen
            </a>
          </Button>
          {downloaded && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Download gestartet
            </span>
          )}
          <p className="text-xs text-muted-foreground sm:ml-auto">
            Entpacken nach <span className="font-mono">Android/data/de.holeschak.bmw_deep_obd/files/</span>
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="mwb">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="mwb" className="gap-1.5">
            <Gauge className="h-3.5 w-3.5" aria-hidden /> MWB-Sets
          </TabsTrigger>
          <TabsTrigger value="adapt" className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Adaption
          </TabsTrigger>
          <TabsTrigger value="catalog" className="gap-1.5">
            <Fuel className="h-3.5 w-3.5" aria-hidden /> Katalog
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-1.5">
            <Stethoscope className="h-3.5 w-3.5" aria-hidden /> Fehler-ECUs
          </TabsTrigger>
        </TabsList>

        {/* MWB-Sets */}
        <TabsContent value="mwb" className="mt-3 space-y-3">
          <NoticeBlock tone="info" icon={<Info className="h-4 w-4" aria-hidden />} title="Echte DDE4-Messwertblöcke (sgbd dde40kw0)">
            Jobs + FSP-Args + Ergebnisnamen 1:1 aus den community-erprobten
            DDE40KW0-Konfigs (E46 330d / E39 525d 530d / X5 3.0d). Die Sets sind
            positionsgebunden – Args und Anzeige gehören immer zusammen.
          </NoticeBlock>

          {DDE4_MWB_SETS.map((set) => (
            <Card key={set.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{set.title}</CardTitle>
                <CardDescription className="text-xs">{set.source}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="font-mono">
                    {set.job}
                  </Badge>
                  <Badge variant="outline" className="break-all font-mono text-[10px]">
                    args={set.args}
                  </Badge>
                </div>
                <MwbFieldTable set={set} />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">Diagnose-Hinweis:</strong> {set.hint}
                </p>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Schwellenwerte (aus C#-FormatResult der Konfig)</CardTitle>
              <CardDescription className="text-xs">
                Farblogik 1:1 aus DDE40KW0.ccpage übernommen – so bewertet die Community die Werte.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <ThresholdList title="Drehzahl (1/min)" rows={DDE4_THRESHOLDS.rpm} />
              <ThresholdList title="Batteriespannung (V)" rows={DDE4_THRESHOLDS.voltage} />
              <ThresholdList title="Vorförderdruck (bar)" rows={DDE4_THRESHOLDS.preSupply} />
              <ThresholdList title="Kühlmitteltemperatur (°C)" rows={DDE4_THRESHOLDS.coolant} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Adaption */}
        <TabsContent value="adapt" className="mt-3 space-y-3">
          <NoticeBlock tone="danger" icon={<ShieldAlert className="h-4 w-4" aria-hidden />} title="Schreib-Adaptionen – bitte mit Bedacht">
            VERSTELLEN + PROG brennen Werte rebootbeständig in die Adaption des
            DDE4. QFLASH21 führt Schreib-Jobs standardmäßig NICHT aus – die
            Referenz hier dient der Vorbereitung und Doku. Lesen ist immer
            gefahrlos.
          </NoticeBlock>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">DDE4-Abgleich-Jobs (identisch für E46/E39/E53)</CardTitle>
              <CardDescription className="text-xs">
                Quelle: DDEAbgleich_DDE40KW0.ccpage (md5 7aee86e8 in allen drei Fahrzeugen).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {DDE4_ADAPTATION_JOBS.map((j) => (
                <div key={j.job} className="flex items-start gap-2 rounded-lg border p-2 text-xs">
                  <Badge
                    variant="outline"
                    className={`shrink-0 border ${DANGER_META[j.danger].className}`}
                  >
                    {DANGER_META[j.danger].label}
                  </Badge>
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-semibold">{j.job}</p>
                    <p className="text-muted-foreground">{j.note}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">DDE3.0-STATUS-Jobs (M47 320d/520d)</CardTitle>
              <CardDescription className="text-xs">
                Aus DDE30DS0.ccpage derselben Sammlung – ältere Diesel-Variante.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {DDE3_STATUS_JOBS.map((j) => (
                  <Badge key={j} variant="secondary" className="font-mono text-[10px]">
                    {j}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Katalog */}
        <TabsContent value="catalog" className="mt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fahrzeugkatalog deiner Sammlung</CardTitle>
              <CardDescription className="text-xs">
                Alle Konfig-Gruppen aus copy_configs/Configurations/BMW – ★ = DDE4.0/EDC15C4-Ziel-ECUs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {USER_CONFIG_CATALOG.map((g) => (
                  <details key={g.chassis} className="rounded-lg border p-2">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                      BMW {g.chassis}
                      <Badge variant="outline" className="text-[10px]">
                        {g.engines.length} Motorgruppen
                      </Badge>
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {g.engines.map((e) => (
                        <div key={e.name} className="rounded border p-2 text-xs">
                          <p className="font-medium">
                            {e.name}
                            {e.dde.includes('DDE40KW0') && (
                              <Badge className="ml-2 border-primary/40 bg-primary/10 text-[10px] text-primary">
                                ★ DDE4.0
                              </Badge>
                            )}
                          </p>
                          <p className="text-muted-foreground">
                            {e.variants.join(' · ')} — ECU: <span className="font-mono">{e.dde}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fehler-ECUs */}
        <TabsContent value="errors" className="mt-3 grid gap-3 md:grid-cols-3">
          {(['E39', 'E46', 'E53'] as const).map((ch) => (
            <Card key={ch}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Fehler-Auslese-ECUs {ch}</CardTitle>
                <CardDescription className="text-xs">{DDE4_ERROR_ECUS[ch].length} Steuergeräte</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-56 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                  {DDE4_ERROR_ECUS[ch].map((e) => (
                    <div
                      key={`${ch}-${e.ecu}`}
                      className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]"
                    >
                      <span className="font-medium">{e.ecu}</span>
                      <span className="font-mono text-muted-foreground">{e.sgbd}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Provenienz */}
      <NoticeBlock tone="warn" icon={<AlertTriangle className="h-4 w-4" aria-hidden />} title="Datenherkunft & Einordnung">
        <ul className="mt-1 list-inside list-disc space-y-1">
          {DDE4_USER_SOURCE_INFO.map((s) => (
            <li key={s.slice(0, 40)}>{s}</li>
          ))}
        </ul>
      </NoticeBlock>
    </div>
  );
}
