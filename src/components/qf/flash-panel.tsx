'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  Download,
  ArrowDownToLine,
  Trash2,
  PenLine,
  ShieldAlert,
  FileWarning,
  CircleCheck,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFlasher } from '@/store/flasher';
import { diffBins, formatHexOffset, formatSize } from '@/lib/kwp/bin';
import { PROTECTED_AREA_SIZE } from '@/lib/kwp/checksum';

const CONFIRM_PHRASE = 'QFLASH21';

export function FlashPanel() {
  const connected = useFlasher((s) => s.connection === 'connected');
  const busy = useFlasher((s) => s.busy);
  const progress = useFlasher((s) => s.progress);
  const bin = useFlasher((s) => s.bin);
  const ecuBin = useFlasher((s) => s.ecuBin);
  const loadBinFile = useFlasher((s) => s.loadBinFile);
  const readEcuFlash = useFlasher((s) => s.readEcuFlash);
  const saveEcuBin = useFlasher((s) => s.saveEcuBin);
  const eraseFlash = useFlasher((s) => s.eraseFlash);
  const writeFlash = useFlasher((s) => s.writeFlash);
  const lastVoltage = useFlasher((s) => s.lastVoltage);

  const fileRef = useRef<HTMLInputElement>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [eraseOpen, setEraseOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const diff = useMemo(() => {
    if (!bin || !ecuBin || bin.size !== ecuBin.size) return null;
    try {
      return diffBins(ecuBin.data, bin.data);
    } catch {
      return null;
    }
  }, [bin, ecuBin]);

  const backupOk = ecuBin !== null && ecuBin.saved;
  const voltageOk = lastVoltage !== null && lastVoltage >= 12.0;
  const phraseOk = phrase === CONFIRM_PHRASE;
  const gateReady = backupOk && voltageOk && phraseOk;

  async function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) await loadBinFile(file);
  }

  function handleWrite() {
    if (!bin) return;
    if (bin.checksumsBad > 0) {
      toast.error('Prüfsummen fehlerhaft', {
        description: 'Prüfsummen-Tab öffnen und Bänke korrigieren, bevor geschrieben wird.',
      });
      return;
    }
    setGateOpen(true);
  }

  function confirmWrite() {
    if (!bin) return;
    setGateOpen(false);
    void writeFlash(bin.data, `${bin.name} (${bin.kind})`);
  }

  const pct = progress ? Math.min(100, Math.round((progress.current / Math.max(1, progress.total)) * 100)) : 0;

  return (
    <div className="space-y-4">
      {progress && (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{progress.label}</span>
              <span className="font-mono">{pct}%</span>
            </div>
            <Progress value={pct} aria-label="Flash-Fortschritt" />
            <p className="mt-2 text-xs text-muted-foreground">
              Über K-Line werden ~58 Bytes pro Block übertragen – Vollbild-Vorgänge dauern real mehrere Minuten.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" aria-hidden />
              BIN-Datei verwalten
            </CardTitle>
            <CardDescription>
              FULL = 512 KiB (komplettes Image) · CAL = 48 KiB (nur Kennfeldbereich). 16 KiB Boot-Bereich sind geschützt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="BIN-Datei auswählen"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void onFiles(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-accent/40'
              }`}
            >
              <Upload className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">BIN hierher ziehen oder klicken</p>
              <p className="text-xs text-muted-foreground">.bin · 524288 B (FULL) oder 49152 B (CAL)</p>
              <input
                ref={fileRef}
                type="file"
                accept=".bin,.BIN,.ori,.mod,application/octet-stream"
                className="sr-only"
                onChange={(e) => void onFiles(e.target.files)}
              />
            </div>

            {bin ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate font-medium">{bin.name}</span>
                  <Badge variant={bin.kind === 'FULL' ? 'default' : 'secondary'}>{bin.kind}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Größe: {formatSize(bin.size)}</span>
                  <span>
                    Prüfsummen:{' '}
                    {bin.checksumsBad === 0 ? (
                      <span className="text-success">{bin.checksumsOk} Bänke OK</span>
                    ) : (
                      <span className="text-destructive">{bin.checksumsBad} fehlerhaft</span>
                    )}
                  </span>
                </div>
                {diff && (
                  <div className="rounded-md bg-muted/50 p-2 text-xs">
                    <p className="font-medium">Diff gegen ECU-Backup:</p>
                    <p>
                      {diff.changedBytes} Bytes geändert in {diff.regions.length} Region(en).{' '}
                      {diff.regions.some((r) => r.start < PROTECTED_AREA_SIZE) && (
                        <span className="font-semibold text-destructive">
                          Achtung: Boot-Bereich berührt!
                        </span>
                      )}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {diff.regions
                        .slice(0, 6)
                        .map((r) => `${formatHexOffset(r.start)}–${formatHexOffset(r.end)}`)
                        .join(' · ')}
                      {diff.regions.length > 6 && ' …'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Noch keine BIN geladen. Ohne Original-Backup kein Schreibzugriff!
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              onClick={() => void readEcuFlash()}
              disabled={!connected || busy}
              variant="secondary"
            >
              <ArrowDownToLine /> Flash aus ECU lesen (512 KiB)
            </Button>
            <Button onClick={saveEcuBin} disabled={!ecuBin} variant="outline">
              <Download /> Backup speichern
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />
              Schreiben & Löschen
            </CardTitle>
            <CardDescription>
              Achtung: DDE4-Flash ändern kann das Steuergerät unbrauchbar machen. Nur mit Backup und stabiler
              Stromversorgung (≥ 12 V) arbeiten.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-3">
              <Checklist
                ok={backupOk}
                text={
                  backupOk
                    ? `Backup gespeichert: ${ecuBin.name}`
                    : ecuBin
                      ? 'Backup ausgelesen, aber noch nicht gespeichert'
                      : 'Kein Backup ausgelesen'
                }
              />
              <Checklist
                ok={voltageOk}
                text={
                  lastVoltage === null
                    ? 'Bordspannung unbekannt (Live-Daten starten)'
                    : voltageOk
                      ? `Bordspannung ok: ${lastVoltage.toFixed(1)} V`
                      : `Bordspannung zu niedrig: ${lastVoltage.toFixed(1)} V (< 12 V)`
                }
              />
              <Checklist ok={bin !== null} text={bin ? `BIN geladen: ${bin.name}` : 'Keine BIN zum Schreiben geladen'} />
              {bin && bin.checksumsBad > 0 && (
                <Checklist ok={false} text={`${bin.checksumsBad} Bänke mit falscher Prüfsumme – erst korrigieren`} />
              )}
            </ul>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={handleWrite}
              disabled={!connected || busy || !bin || bin.checksumsBad > 0}
            >
              <PenLine /> BIN in ECU schreiben
            </Button>
            <Button variant="outline" onClick={() => setEraseOpen(true)} disabled={!connected || busy}>
              <Trash2 /> Flash löschen
            </Button>
            <Button
              variant="ghost"
              disabled={!connected || busy}
              onClick={() => toast.info('Spannung prüfen', { description: 'Live-Daten-Block 0x07 liefert die Bordspannung.' })}
            >
              <Zap /> Spannung prüfen
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Schreib-Gate */}
      <Dialog open={gateOpen} onOpenChange={setGateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <FileWarning className="h-5 w-5" aria-hidden /> Schreibvorgang freischalten
            </DialogTitle>
            <DialogDescription>
              Du schreibst <strong>{bin?.name}</strong> ({bin?.kind}, {formatSize(bin?.size ?? 0)}) in die DDE4.
              Prüfe die Checkliste, tippe dann <strong>{CONFIRM_PHRASE}</strong>.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm">
            <Checklist ok={backupOk} text="Original-Backup gespeichert" compact />
            <Checklist ok={voltageOk} text={voltageOk ? `Spannung ${lastVoltage?.toFixed(1)} V` : 'Spannung ≥ 12 V gemessen'} compact />
            <Checklist ok={bin?.checksumsBad === 0} text="CR2-Prüfsummen der BIN korrekt" compact />
          </ul>
          <div className="space-y-2">
            <Label htmlFor="confirm-phrase">Bestätigungsphrase</Label>
            <Input
              id="confirm-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value.toUpperCase())}
              placeholder={CONFIRM_PHRASE}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGateOpen(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" disabled={!gateReady || busy} onClick={confirmWrite}>
              <PenLine /> Schreiben starten
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lösch-Bestätigung */}
      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" aria-hidden /> Flash löschen?
            </DialogTitle>
            <DialogDescription>
              Die Lösch-Routine (0x31/0xFF00) löscht programmierbare Bänke. Ohne anschließendes Schreiben
              bleibt das Steuergerät startunfähig! Backup ist zwingend.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEraseOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={!backupOk || busy}
              onClick={() => {
                setEraseOpen(false);
                void eraseFlash();
              }}
            >
              <Trash2 /> Löschen (Routine 0xFF00)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Checklist({ ok, text, compact }: { ok: boolean; text: string; compact?: boolean }) {
  return (
    <li className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      {ok ? (
        <CircleCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <FileWarning className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      )}
      <span className={ok ? '' : 'text-muted-foreground'}>{text}</span>
    </li>
  );
}
