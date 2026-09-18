'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Registriert den Service Worker (Offline-Fähigkeit). Rendert nichts sichtbares. */
export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* SW optional – App läuft auch ohne */
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}

/**
 * Installations-Button für die PWA („Zum Startbildschirm hinzufügen“).
 * Erscheint nur, wenn die App noch nicht installiert ist und der Browser
 * das beforeinstallprompt-Ereignis liefert (Chrome/Edge/Android).
 */
export function InstallPwaButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedByEvent, setInstalledByEvent] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);

  // Standalone-Erkennung über Media-Query (externes System, kein Effect-SetState nötig)
  const standalone = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(display-mode: standalone)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true,
    () => false
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setPromptVisible(true);
    };
    const onInstalled = () => {
      setInstalledByEvent(true);
      setPromptVisible(false);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installed = standalone || installedByEvent;
  if (installed || !promptVisible || !deferred) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 border-success/40 text-success hover:bg-success/10 hover:text-success"
      aria-label="QFLASH21 als App installieren"
      onClick={async () => {
        try {
          await deferred.prompt();
          const { outcome } = await deferred.userChoice;
          if (outcome === 'accepted') {
            setInstalledByEvent(true);
          }
          setPromptVisible(false);
          setDeferred(null);
        } catch {
          /* Nutzer abgebrochen */
        }
      }}
    >
      {installed ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      <span className="hidden sm:inline">App installieren</span>
      <span className="sm:hidden">Installieren</span>
    </Button>
  );
}
