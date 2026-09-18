'use client';

import { CircuitBoard, ExternalLink } from 'lucide-react';

export function QfFooter() {
  return (
    <footer className="mt-auto border-t bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-xs text-muted-foreground sm:flex-row">
        <p className="flex items-center gap-1.5">
          <CircuitBoard className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="font-semibold text-foreground">QFLASH21</span> v1.3.0 · Web Serial + WebUSB · offline-first
        </p>
        <p className="text-center">
          Nur für eigene Fahrzeuge und Schulungszwecke. Garantie-/Gewährleistungsausschluss – Eingriffe am
          Motorsteuergerät können die Betriebserlaubnis beeinträchtigen.
        </p>
        <a
          href="https://github.com/uholeschak/ediabaslib"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          Protokoll-Referenz <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    </footer>
  );
}
