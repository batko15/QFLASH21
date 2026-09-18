'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  Cable,
  Smartphone,
  MonitorSmartphone,
  Play,
  Square,
  RefreshCw,
  FlaskConical,
  ShieldCheck,
  AlertTriangle,
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
import { Label } from '@/components/ui/label';
import { useFlasher } from '@/store/flasher';
import { BAUD_RATES } from '@/lib/kwp/serial-client';

export function ConnectionPanel() {
  const supported = useFlasher((s) => s.supported);
  const android = useFlasher((s) => s.android);
  const connection = useFlasher((s) => s.connection);
  const portLabel = useFlasher((s) => s.portLabel);
  const isMock = useFlasher((s) => s.isMock);
  const baudRate = useFlasher((s) => s.baudRate);
  const keywords = useFlasher((s) => s.keywords);
  const initSteps = useFlasher((s) => s.initSteps);
  const busy = useFlasher((s) => s.busy);
  const connectMock = useFlasher((s) => s.connectMock);
  const connectReal = useFlasher((s) => s.connectReal);
  const disconnect = useFlasher((s) => s.disconnect);
  const setBaudRate = useFlasher((s) => s.setBaudRate);
  const initSupport = useFlasher((s) => s.initSupport);
  const readIdent = useFlasher((s) => s.readIdent);

  useEffect(() => {
    initSupport();
  }, [initSupport]);

  const connecting = connection === 'connecting' || connection === 'initializing';
  const connected = connection === 'connected';
  const canConnect = !connecting && !busy;

  async function handleConnect() {
    if (!supported) {
      toast.error('Web Serial nicht verfügbar', {
        description:
          'Android: Chrome ≥ 138 erforderlich. Desktop: Chrome/Edge ≥ 89. iOS/Safari wird nicht unterstützt.',
      });
      return;
    }
    try {
      await connectReal();
      // Nach dem Verbinden direkt Ident lesen (wie Deep OBD Quick-Start)
      setTimeout(() => {
        void readIdent();
      }, 300);
    } catch {
      // Fehler bereits im Store behandelt
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-primary" aria-hidden />
            Serielle Verbindung
          </CardTitle>
          <CardDescription>
            K+DCAN-Adapter (FTDI FT232RL, 0403:6001) per Web Serial verbinden.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              {supported ? (
                <ShieldCheck className="h-5 w-5 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
              )}
              <div>
                <p className="text-sm font-medium">Web Serial API</p>
                <p className="text-xs text-muted-foreground">
                  {supported ? 'Verfügbar – Hardware-Anschluss möglich' : 'Nicht verfügbar (HTTPS + Chrome/Edge nötig)'}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={initSupport} aria-label="Erneut prüfen">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="baud">Baudrate</Label>
            <select
              id="baud"
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-describedby="baud-help"
            >
              {BAUD_RATES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <p id="baud-help" className="text-xs text-muted-foreground">
              Standard für DDE4 ist 10400 Bd. 38400 (SLOW WRITE) für empfindliche Adapter.
            </p>
          </div>

          {keywords && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                Schlüsselwörter: 0x{keywords[0].toString(16).toUpperCase().padStart(2, '0')} 0x
                {keywords[1].toString(16).toUpperCase().padStart(2, '0')}
              </p>
              <div className="mt-1 text-xs text-muted-foreground">
                Erwartet für DDE4.0: 0x45 0x05{' '}
                {keywords[0] === 0x45 && keywords[1] === 0x05 ? (
                  <Badge variant="success" className="ml-1">bestätigt</Badge>
                ) : (
                  <Badge variant="warning" className="ml-1">abweichend</Badge>
                )}
              </div>
            </div>
          )}

          {initSteps.length > 0 && (
            <ol className="space-y-1.5 rounded-lg border p-3 text-sm">
              {initSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {connected ? (
            <Button variant="destructive" onClick={() => void disconnect()} disabled={busy}>
              <Square /> Trennen
            </Button>
          ) : (
            <Button onClick={() => void handleConnect()} disabled={!canConnect}>
              <Play /> Verbinden (echter Adapter)
            </Button>
          )}
          {!connected && (
            <Button variant="secondary" onClick={() => void connectMock()} disabled={!canConnect}>
              <FlaskConical /> Simulator starten
            </Button>
          )}
          {connected && (
            <Button variant="outline" onClick={() => void readIdent()} disabled={busy}>
              <RefreshCw /> Ident neu lesen
            </Button>
          )}
        </CardFooter>
      </Card>

      <div className="space-y-4">
        <Card className={android ? 'border-primary/50' : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" aria-hidden />
              Android-Verbindung (USB-C OTG)
            </CardTitle>
            <CardDescription>
              {android ? 'Android-Gerät erkannt – Schritte befolgen:' : 'So verbindest du das Kabel am Handy:'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                <span>
                  <strong>OTG-Adapter</strong> (USB-C → USB-A) ans Handy, dann K+DCAN-Kabel einstecken.
                  <span className="block text-xs text-muted-foreground">Manche Handys brauchen ein geladenes Kabel – ST232/FTDI-Chipsätze bevorzugen.</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                <span>
                  <strong>Chrome öffnen</strong> (Android: ab Version 138, Desktop: Chrome/Edge 89+) – Web Serial
                  funktioniert nur dort und nur über HTTPS.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                <span>
                  <strong>Zündung einschalten</strong> (Stellung 2), dann auf „Verbinden“ tippen und den Adapter im Dialog auswählen.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                <span>
                  5-Baud-Init dauert <strong>ca. 2 Sekunden</strong> – Bildschirm anlassen und das Handy nicht sperren.
                </span>
              </li>
            </ol>
            {android && (
              <p className="mt-3 flex items-center gap-2 rounded-md bg-primary/10 p-2 text-xs text-primary">
                <MonitorSmartphone className="h-4 w-4" aria-hidden /> Android erkannt – OTG-Kabel bereit?
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Zustand</span>
              <Badge
                variant={
                  connected ? 'success' : connection === 'error' ? 'destructive' : connecting ? 'warning' : 'secondary'
                }
              >
                {connection === 'disconnected' && 'Nicht verbunden'}
                {connection === 'connecting' && 'Verbinde …'}
                {connection === 'initializing' && 'Initialisiere (5-Baud) …'}
                {connection === 'connected' && 'Verbunden'}
                {connection === 'busy' && 'Beschäftigt'}
                {connection === 'error' && 'Fehler'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Port</span>
              <span className="max-w-[60%] truncate text-right font-medium">{portLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Quelle</span>
              <Badge variant="outline">{isMock ? 'Simulator' : 'Echte Hardware'}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
