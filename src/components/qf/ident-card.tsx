'use client';

import { Fingerprint, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher } from '@/store/flasher';
import type { EcuIdent } from '@/lib/kwp/types';

const FIELD_LABELS: { key: keyof EcuIdent; label: string }[] = [
  { key: 'ecuType', label: 'Steuergerät-Typ' },
  { key: 'partNumber', label: 'Bosch-Teilenummer' },
  { key: 'softwareVersion', label: 'Software-Version' },
  { key: 'hardwareNumber', label: 'Hardware-Nummer' },
  { key: 'engineCode', label: 'Motor-Kennung' },
  { key: 'vin', label: 'Fahrgestellnummer (VIN)' },
  { key: 'serialNumber', label: 'Seriennummer' },
  { key: 'immobilizerId', label: 'Wegfahrsperre (EWS)' },
  { key: 'coding', label: 'Codierung / WSG' },
  { key: 'workshopCode', label: 'Werkstattcode' },
];

export function IdentCard() {
  const ident = useFlasher((s) => s.ident);
  const connected = useFlasher((s) => s.connection === 'connected');
  const busy = useFlasher((s) => s.busy);
  const readIdent = useFlasher((s) => s.readIdent);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" aria-hidden />
            ECU-Identifikation
          </CardTitle>
          <CardDescription>
            Service 0x1A mit Lokal-IDs (0x89–0x9F) gemäß EDC15-Konvention.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => void readIdent()} disabled={!connected || busy}>
          <RefreshCw /> Neu lesen
        </Button>
      </CardHeader>
      <CardContent>
        {ident ? (
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {FIELD_LABELS.map((f) => (
              <div key={f.key} className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0">
                <dt className="text-sm text-muted-foreground">{f.label}</dt>
                <dd className="max-w-[60%] truncate font-mono text-sm font-medium">{ident[f.key] || '–'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Fingerprint className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Noch keine Daten. Erst verbinden, dann „Neu lesen“ drücken.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void readIdent()} disabled={!connected || busy}>
              <RefreshCw /> Identifikation lesen
            </Button>
          </div>
        )}
        {ident && (
          <div className="mt-4 flex flex-wrap gap-2">
            {ident.engineCode?.includes('M57') && <Badge variant="success">M57-Diesel erkannt</Badge>}
            {ident.partNumber?.startsWith('0 281') && <Badge variant="outline">Bosch EDC15-Familie</Badge>}
            <Badge variant="secondary">KWP2000 (ISO 14230)</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
