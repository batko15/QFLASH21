'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  CircuitBoard,
  Sun,
  Moon,
  Wifi,
  LayoutDashboard,
  Cable,
  Fingerprint,
  ScanSearch,
  Gauge,
  Wrench,
  SlidersHorizontal,
  Save,
  ShieldCheck,
  ScrollText,
  Stethoscope,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFlasher } from '@/store/flasher';
import { OverviewTab } from '@/components/qf/tabs/overview-tab';
import { ConnectionPanel } from '@/components/qf/connection-panel';
import { IdentCard } from '@/components/qf/ident-card';
import { DtcPanel } from '@/components/qf/dtc-panel';
import { LivePanel } from '@/components/qf/live-panel';
import { JobsPanel } from '@/components/qf/jobs-panel';
import { TuningPanel } from '@/components/qf/tuning-panel';
import { SystemCheckPanel } from '@/components/qf/system-check-panel';
import { FlashPanel } from '@/components/qf/flash-panel';
import { ChecksumPanel } from '@/components/qf/checksum-panel';
import { LogPanel } from '@/components/qf/log-panel';
import { QfFooter } from '@/components/qf/footer';
import { SwRegister, InstallPwaButton } from '@/components/qf/pwa';
import { cn } from '@/lib/utils';

const TABS: { value: string; label: string; short: string; icon: LucideIcon; mobile?: boolean }[] = [
  { value: 'uebersicht', label: 'Übersicht', short: 'Start', icon: LayoutDashboard, mobile: true },
  { value: 'verbindung', label: 'Verbindung', short: 'Verbin.', icon: Cable, mobile: true },
  { value: 'ecu-id', label: 'ECU-ID', short: 'ECU', icon: Fingerprint },
  { value: 'fehlerspeicher', label: 'Fehlerspeicher', short: 'Fehler', icon: ScanSearch, mobile: true },
  { value: 'live', label: 'Live-Daten', short: 'Live', icon: Gauge, mobile: true },
  { value: 'jobs', label: 'Jobs', short: 'Jobs', icon: Wrench, mobile: true },
  { value: 'tuning', label: 'Tuning-Wissen', short: 'Tuning', icon: SlidersHorizontal, mobile: true },
  { value: 'check', label: 'System-Check', short: 'Check', icon: Stethoscope, mobile: true },
  { value: 'flash', label: 'Lesen/Schreiben', short: 'Flash', icon: Save },
  { value: 'pruefsumme', label: 'Prüfsumme', short: 'Prüf', icon: ShieldCheck },
  { value: 'protokoll', label: 'Protokoll', short: 'Protokoll', icon: ScrollText },
];

export function QfApp() {
  // ?tab=… aus URL (PWA-Shortcuts) hydration-sicher: erst nach Hydration aktiv
  const urlTab = useSyncExternalStore(
    () => () => {},
    () => {
      const t = new URLSearchParams(window.location.search).get('tab');
      return t && TABS.some((x) => x.value === t) ? t : null;
    },
    () => null
  );
  const [tabState, setTab] = useState<string | null>(null);
  const tab = tabState ?? urlTab ?? 'uebersicht';
  const connection = useFlasher((s) => s.connection);
  const isMock = useFlasher((s) => s.isMock);
  const initSupport = useFlasher((s) => s.initSupport);

  useEffect(() => {
    initSupport();
  }, [initSupport]);

  const connected = connection === 'connected';

  return (
    <div className="flex min-h-screen flex-col">
      <SwRegister />
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CircuitBoard className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight">
              QFLASH<span className="text-primary">21</span>
            </h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              DDE4-Diagnose & Flash über K-Line · KWP2000
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge
              variant={connected ? 'success' : connection === 'error' ? 'destructive' : 'secondary'}
              className="hidden sm:inline-flex"
            >
              <Wifi className="mr-1 h-3 w-3" aria-hidden />
              {connected ? (isMock ? 'Simulator' : 'Verbunden') : 'Offline'}
            </Badge>
            <InstallPwaButton />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 sm:pb-4">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto pb-1 custom-scrollbar">
            <TabsList className="inline-flex min-w-full sm:min-w-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="whitespace-nowrap">
                  <t.icon className="mr-1.5 h-3.5 w-3.5 hidden sm:inline" aria-hidden />
                  {t.label}
                  {t.value === 'fehlerspeicher' && connection === 'connected' && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="uebersicht">
            <OverviewTab onGoTab={setTab} />
          </TabsContent>
          <TabsContent value="verbindung">
            <ConnectionPanel />
          </TabsContent>
          <TabsContent value="ecu-id">
            <IdentCard />
          </TabsContent>
          <TabsContent value="fehlerspeicher">
            <DtcPanel />
          </TabsContent>
          <TabsContent value="live">
            <LivePanel />
          </TabsContent>
          <TabsContent value="jobs">
            <JobsPanel />
          </TabsContent>
          <TabsContent value="tuning">
            <TuningPanel />
          </TabsContent>
          <TabsContent value="check">
            <SystemCheckPanel />
          </TabsContent>
          <TabsContent value="flash">
            <FlashPanel />
          </TabsContent>
          <TabsContent value="pruefsumme">
            <ChecksumPanel />
          </TabsContent>
          <TabsContent value="protokoll">
            <LogPanel />
          </TabsContent>
        </Tabs>
      </main>

      <QfFooter />

      {/* Mobile-Bottom-Navigation (Android-optimiert, DeepOBD-Prinzip) */}
      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-7">
          {TABS.filter((t) => t.mobile).map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setTab(t.value)}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[10px] transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <t.icon className="h-5 w-5" aria-hidden />
                <span className="font-medium">{t.short}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Hydration-sicher: serverseitig "false", clientseitig nach Mount "true"
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Farbschema umschalten"
      className={cn(!mounted && 'opacity-0')}
    >
      {mounted && resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export function GithubLink() {
  return null;
}
