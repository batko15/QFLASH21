'use client';

import { FlaskConical, Fingerprint, ScanSearch, Gauge, Cable, Cpu, TriangleAlert, CircleCheck, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher, VEHICLES } from '@/store/flasher';
import { cn } from '@/lib/utils';

export function OverviewTab({ onGoTab }: { onGoTab: (tab: string) => void }) {
  const connection = useFlasher((s) => s.connection);
  const isMock = useFlasher((s) => s.isMock);
  const supported = useFlasher((s) => s.supported);
  const portLabel = useFlasher((s) => s.portLabel);
  const ident = useFlasher((s) => s.ident);
  const dtcs = useFlasher((s) => s.dtcs);
  const shadowDtcs = useFlasher((s) => s.shadowDtcs);
  const dtcReadAt = useFlasher((s) => s.dtcReadAt);
  const bin = useFlasher((s) => s.bin);
  const ecuBin = useFlasher((s) => s.ecuBin);
  const vehicle = useFlasher((s) => s.vehicle);
  const setVehicle = useFlasher((s) => s.setVehicle);
  const connectMock = useFlasher((s) => s.connectMock);
  const readIdent = useFlasher((s) => s.readIdent);
  const readDtc = useFlasher((s) => s.readDtc);

  const connected = connection === 'connected';
  const vehicleMeta = VEHICLES.find((v) => v.id === vehicle);
  const totalFaults = dtcs.length + shadowDtcs.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          icon={<Cable className="h-5 w-5" />}
          title="Adapter"
          value={connected ? (isMock ? 'Simulator' : 'K+DCAN aktiv') : 'Nicht verbunden'}
          hint={connected ? portLabel : supported ? 'Bereit zum Verbinden' : 'Web Serial nicht verfügbar'}
          ok={connected}
          onClick={() => onGoTab('verbindung')}
        />
        <StatusCard
          icon={<Cpu className="h-5 w-5" />}
          title="Steuergerät"
          value={ident ? ident.ecuType : connected ? 'Noch nicht identifiziert' : '–'}
          hint={ident ? `SW ${ident.softwareVersion} · Teile-Nr. ${ident.partNumber}` : 'DDE4.0 (EDC15C4) erwartet'}
          ok={!!ident}
          onClick={() => onGoTab('ecu-id')}
        />
        <StatusCard
          icon={<ScanSearch className="h-5 w-5" />}
          title="Fehlerspeicher"
          value={totalFaults === 0 ? (dtcReadAt ? 'Leer' : '–') : `${totalFaults} Einträge`}
          hint={dtcReadAt ? `Normal: ${dtcs.length} · Schatten: ${shadowDtcs.length}` : 'Noch nicht ausgelesen'}
          ok={dtcReadAt !== null && totalFaults === 0}
          warn={totalFaults > 0}
          onClick={() => onGoTab('fehlerspeicher')}
        />
        <StatusCard
          icon={<Gauge className="h-5 w-5" />}
          title="BIN / Backup"
          value={bin ? `${bin.kind} geladen` : ecuBin ? 'Backup vorhanden' : 'Kein Bild'}
          hint={
            bin
              ? `${bin.checksumsOk} Bänke OK · ${bin.checksumsBad} fehlerhaft`
              : 'BIN laden oder Flash auslesen'
          }
          ok={!!bin}
          onClick={() => onGoTab('flash')}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fahrzeug wählen</CardTitle>
          <CardDescription>DDE4.0 steckt in allen M47/M57-Dieseln dieser Baureihen.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fahrzeug auswählen">
            {VEHICLES.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={vehicle === v.id}
                onClick={() => setVehicle(v.id)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm transition-colors',
                  vehicle === v.id
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {v.label}
                <span className="ml-2 text-xs text-muted-foreground">{v.engine}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schnellaktionen</CardTitle>
          <CardDescription>Typischer Arbeitsablauf mit einem verbundenen Steuergerät.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => onGoTab('verbindung')} variant="outline">
            <Cable /> Verbindung
          </Button>
          <Button onClick={() => void readIdent()} disabled={!connected}>
            <Fingerprint /> Identifikation lesen
          </Button>
          <Button onClick={() => void readDtc()} disabled={!connected}>
            <ScanSearch /> Fehlerspeicher lesen
          </Button>
          <Button onClick={() => onGoTab('live')} variant="outline" disabled={!connected}>
            <Gauge /> Live-Daten
          </Button>
          <Button onClick={() => onGoTab('jobs')} variant="outline" disabled={!connected}>
            <Wrench /> Steuergeräte-Jobs
          </Button>
          <Button onClick={() => onGoTab('flash')} variant="outline" disabled={!connected}>
            <TriangleAlert /> Lesen / Schreiben
          </Button>
          {!connected && (
            <Button variant="secondary" onClick={() => void connectMock()}>
              <FlaskConical /> Ohne Fahrzeug testen (Simulator)
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Boardnetz-Kontext</CardTitle>
          <CardDescription>
            {vehicleMeta
              ? `${vehicleMeta.label} · Motor ${vehicleMeta.engine} · DDE4.0 (Bosch EDC15C4) · K-Line Adresse 0x12`
              : 'Fahrzeug wählen'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden /> 5-Baud-Init über K-Line (PIN 7 OBD)
          </div>
          <div className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden /> KWP2000: Ident, Fehlerspeicher, Flash
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">10400 Bd</Badge> Standard-Baudrate nach Slow-Init
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">512 KiB</Badge> Full-Flash · 16 KiB Boot geschützt
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  value,
  hint,
  ok,
  warn,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  hint: string;
  ok?: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="text-primary">{icon}</span>
          {title}
        </span>
        {ok ? (
          <CircleCheck className="h-4 w-4 text-success" aria-label="OK" />
        ) : warn ? (
          <TriangleAlert className="h-4 w-4 text-warning" aria-label="Auffällig" />
        ) : null}
      </div>
      <p className="mt-2 truncate text-lg font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
    </button>
  );
}
