'use client';

/**
 * QFLASH21 – System-Check (Selbstdiagnose der Umgebung)
 *
 * Prüft alle Voraussetzungen für die K-Line-Diagnose am Telefon/PC und zeigt
 * dem Nutzer GENAU, was fehlt – ohne dass Screenshots versendet werden müssen.
 * Erzeugt einen kopierbaren Diagnose-Bericht für den Remote-Support.
 */

import { useState, useSyncExternalStore, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bluetooth,
  CheckCircle2,
  Copy,
  Download,
  MonitorSmartphone,
  Smartphone,
  Usb,
  XCircle,
  Chrome,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  WEBUSB_FILTERS,
} from '@/lib/kwp/webusb-serial';
import { isNativeBridge, listNativeDevices, type QfNativeDeviceInfo } from '@/lib/kwp/native-bridge';

/** Aktuelle Web-App-Version (parallel zur APK-Version halten) */
const APP_VERSION = '2.1.0';
const APK_URL = '/apk/QFLASH21-v2.1.0.apk';

type Status = 'ok' | 'warn' | 'fail' | 'info';

interface CheckRow {
  label: string;
  detail: string;
  status: Status;
  icon: React.ComponentType<{ className?: string }>;
}

interface EnvSnapshot {
  serial: boolean;
  webusb: boolean;
  native: boolean;
  secure: boolean;
  ua: string;
  chromeVersion: number | null;
  isAndroid: boolean;
  androidVersion: string | null;
  standalone: boolean;
  grantedSerial: string[];
  grantedUsb: string[];
}

function readEnv(): EnvSnapshot | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  const m = /Chrome\/(\d+)/.exec(ua);
  const androidM = /Android\s+(\d+(?:\.\d+)?)/.exec(ua);
  let standalone = false;
  try {
    standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    /* ignore */
  }
  return {
    serial: 'serial' in navigator,
    webusb: 'usb' in navigator,
    native: isNativeBridge(),
    secure: window.isSecureContext,
    ua,
    chromeVersion: m ? Number(m[1]) : null,
    isAndroid: /Android/.test(ua),
    androidVersion: androidM ? androidM[1] : null,
    standalone,
    grantedSerial: [],
    grantedUsb: [],
  };
}

export function SystemCheckPanel() {
  // Hydration-sicher: Umgebung erst nach Mount lesen (useSyncExternalStore-Snapshot)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [grantedSerial, setGrantedSerial] = useState<string[]>([]);
  const [grantedUsb, setGrantedUsb] = useState<string[]>([]);
  const [nativeDevices, setNativeDevices] = useState<QfNativeDeviceInfo[]>([]);
  const [scanned, setScanned] = useState(false);
  const [copied, setCopied] = useState(false);

  const env = mounted ? readEnv() : null;

  const scanGranted = useCallback(async () => {
    const out: { serial: string[]; usb: string[] } = { serial: [], usb: [] };
    try {
      if (isNativeBridge()) {
        setNativeDevices(await listNativeDevices());
      }
    } catch {
      /* ignore */
    }
    try {
      const s = (navigator as unknown as {
        serial?: { getDevices(): Promise<{ productName?: string; vendorId?: number; productId?: number }[]> };
      }).serial;
      if (s) {
        const devs = await s.getDevices();
        out.serial = devs.map(
          (d) =>
            `${d.productName ?? 'Unbekannt'} (VID ${d.vendorId?.toString(16) ?? '?'} / PID ${d.productId?.toString(16) ?? '?'})`
        );
      }
    } catch {
      /* ignore */
    }
    try {
      const u = (navigator as unknown as {
        usb?: {
          getDevices(): Promise<{ productName?: string; vendorId?: number; productId?: number }[]>;
        };
      }).usb;
      if (u) {
        const devs = await u.getDevices();
        out.usb = devs.map(
          (d) =>
            `${d.productName ?? 'Unbekannt'} (VID ${d.vendorId?.toString(16) ?? '?'} / PID ${d.productId?.toString(16) ?? '?'})`
        );
      }
    } catch {
      /* ignore */
    }
    setGrantedSerial(out.serial);
    setGrantedUsb(out.usb);
    setScanned(true);
  }, []);

  if (!env) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Umgebungs-Check wird nach dem Laden ausgeführt …
        </CardContent>
      </Card>
    );
  }

  // Chrome-USB-Serial-Heuristik (MDN browser-compat-data, api/Serial.json):
  // Android-Chrome 138–147: nur Bluetooth-Serial · ab 148: volle USB-Serial.
  const usbSerialNative =
    env.serial && (!env.isAndroid || (env.chromeVersion !== null && env.chromeVersion >= 148));
  const usbViaWebUsb = !usbSerialNative && env.webusb;
  const anyUsbPath = usbSerialNative || usbViaWebUsb;

  const rows: CheckRow[] = [
    {
      label: 'Native Android-App',
      detail: env.native
        ? 'QFLASH21-App v2 erkannt – native USB-Serial-Bridge aktiv (kein Chrome nötig)'
        : 'Nicht in der App geöffnet – Web-Pfade aktiv (APK v2 empfohlen)',
      status: env.native ? 'ok' : 'info',
      icon: Smartphone,
    },
    {
      label: 'Web Serial API',
      detail: env.serial
        ? `Verfügbar (Chrome ${env.chromeVersion ?? '?'})`
        : 'Nicht verfügbar – Chrome/Edge verwenden',
      status: env.serial ? 'ok' : env.webusb ? 'warn' : 'fail',
      icon: Chrome,
    },
    {
      label: 'USB-Serial nativ',
      detail: !env.serial
        ? 'Web Serial fehlt → WebUSB-Fallback'
        : !env.isAndroid
          ? 'Desktop: USB-Adapter unterstützt'
          : env.chromeVersion !== null && env.chromeVersion >= 148
            ? `Chrome ${env.chromeVersion} ≥ 148: K+DCAN per USB-OTG nativ`
            : `Chrome ${env.chromeVersion} < 148: nur Bluetooth-Serial – USB über WebUSB-Fallback`,
      status: usbSerialNative ? 'ok' : usbViaWebUsb ? 'warn' : 'fail',
      icon: Usb,
    },
    {
      label: 'WebUSB-Fallback',
      detail: env.webusb
        ? `Verfügbar – K+DCAN (FTDI/CH340/CP2102) läuft auf jedem Android-Chrome`
        : 'Nicht verfügbar (älterer Browser)',
      status: env.webusb ? 'ok' : 'fail',
      icon: Usb,
    },
    {
      label: 'Sicherer Kontext (HTTPS)',
      detail: env.secure ? 'Aktiv (Pflicht für Serial/USB)' : 'Kein HTTPS – Serial/USB blockiert!',
      status: env.secure ? 'ok' : 'fail',
      icon: BadgeCheck,
    },
    {
      label: 'App-Modus',
      detail: env.standalone
        ? 'Standalone (APK/PWA fullscreen) – ideal'
        : 'Browser-Tab (funktioniert auch, APK empfohlen)',
      status: env.standalone ? 'ok' : 'info',
      icon: MonitorSmartphone,
    },
    {
      label: 'Plattform',
      detail: env.isAndroid
        ? `Android ${env.androidVersion ?? '?'} · Chrome ${env.chromeVersion ?? '?'}`
        : `Desktop · Chrome ${env.chromeVersion ?? '?'} · Web Serial ${env.serial ? 'ok' : 'nein'}`,
      status: 'info',
      icon: Smartphone,
    },
    {
      label: 'Bluetooth-Serial',
      detail:
        env.serial && env.isAndroid && (env.chromeVersion ?? 0) >= 138
          ? 'Chrome ≥ 138: Bluetooth-Adapter (RFCOMM) nutzbar'
          : 'Nur mit Chrome ≥ 138 (Android)',
      status: env.serial && (env.chromeVersion ?? 0) >= 138 ? 'ok' : 'info',
      icon: Bluetooth,
    },
  ];

  const verdict: { status: Status; title: string; text: string } = env.native
    ? {
        status: 'ok',
        title: 'Bereit – Standalone-App (USB-Host-API, 100 % offline)',
        text: 'QFLASH21-App v2.1 erkannt: Das K+DCAN-Kabel läuft NATIV über die Android USB-Host-API (FTDI/CH340/CP2102). Die komplette Oberfläche ist EINGEBETTET – die App braucht kein Internet und keinen Chrome. Kabel anschließen und „Verbinden“ tippen.',
      }
    : !env.secure
    ? {
        status: 'fail',
        title: 'Kein sicherer Kontext',
        text: 'Die Seite muss über HTTPS geladen werden (qflashk.vercel.app erfüllt das).',
      }
    : !anyUsbPath
      ? {
          status: 'fail',
          title: 'Kein USB-Serial-Pfad verfügbar',
          text: 'Die QFLASH21-APK v2.1.0 installieren (Standalone, kein Chrome/Internet nötig) – oder Google Chrome und diese Seite darin öffnen.',
        }
      : env.serial && usbSerialNative
        ? {
            status: 'ok',
            title: 'Bereit für K+DCAN per USB-OTG',
            text: 'Kabel anschließen, „Verbinden“ tippen, USB-Gerät auswählen – fertig.',
          }
        : {
            status: 'warn',
            title: 'Bereit – über WebUSB-Fallback',
            text: 'Dein Chrome rendert USB-Serial über den integrierten WebUSB-Treiber (FTDI/CH340/CP2102). Funktioniert ab jedem Android-Chrome; für nativen USB-Serial Chrome ≥ 148 updaten.',
          };

  const report = buildReport(env, grantedSerial, grantedUsb, verdict);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Clipboard blockiert – Text ist sichtbar, kann manuell kopiert werden */
    }
  };

  return (
    <div className="space-y-4">
      {/* Urteils-Banner */}
      <Card className={verdictBorder(verdict.status)}>
        <CardContent className="flex items-start gap-3 p-4">
          {verdictIcon(verdict.status)}
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{verdict.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{verdict.text}</p>
          </div>
        </CardContent>
      </Card>

      {/* Checkliste */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" aria-hidden />
            Umgebung-Prüfung
          </CardTitle>
          <CardDescription>
            Alles, was QFLASH21 braucht, um mit dem DDE4.0 zu sprechen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-start gap-3 rounded-lg border bg-card/50 p-3"
            >
              <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.label}</span>
                  {statusBadge(r.status)}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => void scanGranted()}>
              Erlaubte Geräte prüfen
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copyReport()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {copied ? 'Kopiert!' : 'Diagnose-Bericht kopieren'}
            </Button>
          </div>
          {scanned && (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Erlaubte Geräte</p>
              {env.native && (
                <p>
                  Native-App: {nativeDevices.length ? nativeDevices.map((d) => `${d.name} (${d.driver})`).join(' · ') : 'kein Adapter angeschlossen'}
                </p>
              )}
              <p>Serial: {grantedSerial.length ? grantedSerial.join(' · ') : 'keine'}</p>
              <p>USB: {grantedUsb.length ? grantedUsb.join(' · ') : 'keine'}</p>
              {!grantedSerial.length && !grantedUsb.length && !nativeDevices.length && (
                <p className="mt-1">
                  Noch kein Gerät erlaubt? Kabel anschließen und im Tab „Verbindung“ auf
                  Verbinden tippen – der Browser fragt dann nach dem Adapter.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* APK-Sektion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Android-App (Standalone) v{APP_VERSION}</CardTitle>
          <CardDescription>
            Echte App mit eigener USB-Treiberschicht (FTDI/CH340/CP2102) und KOMPLETT
            eingebetteter Oberfläche: 100 % offline, kein Chrome, kein Internet, keine
            Website nötig. Läuft auf jedem Android-Gerät ab 7.0.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild>
            <a href={APK_URL} download>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              APK v{APP_VERSION} herunterladen (Standalone, ~9 MB)
            </a>
          </Button>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">APK herunterladen und öffnen</strong>{' '}
              (Dateimanager → Downloads). v2.1.0 installiert direkt über v2.0.0/v1.3.x
              (gleiche Signatur) – alte QFLASH21-Apps (v1.0–v1.2, andere Paket-ID) danach deinstallieren.
            </li>
            <li>
              MagicOS: Bei „Aus unbekannter Quelle installieren?“ den Browser/Dateimanager
              <strong className="text-foreground"> erlauben</strong> – oder vorher
              Einstellungen → Sicherheit → Pure Mode deaktivieren.
            </li>
            <li>
              <strong className="text-foreground">Kein Chrome nötig, kein Internet:</strong> Die
              App spricht das K+DCAN-Kabel direkt über die Android USB-Host-API an (Kabel per
              USB-OTG anschließen – beim ersten Mal USB-Berechtigung bestätigen). Flugmodus ist
              OK – sämtliche Daten (auch DeepOBD-Konfigs) sind im APK enthalten.
            </li>
            <li>App öffnen → dieser System-Check zeigt „Standalone-App“ (grün).</li>
            <li>
              Sollte die App je Fehler zeigen: Der native{' '}
              <strong className="text-foreground">Fehlerbericht</strong> erscheint mit
              „Fehler kopieren“-Button – Bericht einfach hier einfügen.
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Kopierbarer Bericht */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Diagnose-Bericht</CardTitle>
          <CardDescription>
            Zum Einfügen in Support-Anfragen (Knopf oben kopiert alles).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed custom-scrollbar">
            {report}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function statusBadge(status: Status) {
  switch (status) {
    case 'ok':
      return <Badge variant="success">OK</Badge>;
    case 'warn':
      return (
        <Badge variant="warning">
          <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
          Fallback
        </Badge>
      );
    case 'fail':
      return <Badge variant="destructive">Fehlt</Badge>;
    default:
      return <Badge variant="secondary">Info</Badge>;
  }
}

function verdictIcon(status: Status) {
  if (status === 'ok') return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />;
  if (status === 'fail') return <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />;
  if (status === 'warn') return <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />;
  return <Activity className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />;
}

function verdictBorder(status: Status) {
  switch (status) {
    case 'ok':
      return 'border-success/40';
    case 'fail':
      return 'border-destructive/40';
    case 'warn':
      return 'border-warning/40';
    default:
      return '';
  }
}

function buildReport(
  env: EnvSnapshot,
  grantedSerial: string[],
  grantedUsb: string[],
  verdict: { title: string; text: string }
): string {
  const lines = [
    'QFLASH21 System-Check',
    `Version: ${APP_VERSION} (Web-App)`,
    `Zeit: ${new Date().toISOString()}`,
    `Plattform: ${env.isAndroid ? `Android ${env.androidVersion ?? '?'}` : 'Desktop'}`,
    `Browser: ${env.chromeVersion ? `Chrome ${env.chromeVersion}` : env.ua.slice(0, 80)}`,
    `Web Serial: ${env.serial ? 'ja' : 'nein'}`,
    `WebUSB: ${env.webusb ? 'ja' : 'nein'}`,
    `Native-App-Bridge: ${env.native ? 'ja (USB-Host-API aktiv)' : 'nein'}`,
    `USB-Serial nativ (Chrome>=148): ${env.serial && (!env.isAndroid || (env.chromeVersion ?? 0) >= 148) ? 'ja' : 'nein'}`,
    `HTTPS: ${env.secure ? 'ja' : 'nein'}`,
    `Modus: ${env.standalone ? 'standalone (APK/PWA)' : 'Browser-Tab'}`,
    `Erlaubte Serial-Ports: ${grantedSerial.length ? grantedSerial.join('; ') : 'keine'}`,
    `Erlaubte USB-Geräte: ${grantedUsb.length ? grantedUsb.join('; ') : 'keine'}`,
    `Filter: ${WEBUSB_FILTERS.map((f) => `${f.vendorId.toString(16)}:${f.productId.toString(16)}`).join(', ')}`,
    `Fazit: ${verdict.title}`,
  ];
  return lines.join('\n');
}
