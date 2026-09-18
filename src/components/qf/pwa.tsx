'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Download, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Registriert den Service Worker (Offline-Fähigkeit) + Update-Hinweis. Rendert nichts sichtbares. */
export function SwRegister() {
  useEffect(() => {
    // SW nur in Produktion: im Dev-Modus würde der Cache-first-Asset-Cache
    // Hot-Reload/HMR-Module einfrieren (Stale-Code-Debugging-Falle).
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Update-Erkennung: neue SW installiert → Nutzer informieren
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                toast.info('Update verfügbar', {
                  description: 'Eine neue QFLASH21-Version ist geladen.',
                  action: { label: 'Neu laden', onClick: () => window.location.reload() },
                  duration: 12000,
                });
              }
            });
          });
        })
        .catch(() => {
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
