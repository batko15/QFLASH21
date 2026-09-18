'use client';

import { CheckCircle2, XCircle, Wand2, FileDigit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useFlasher } from '@/store/flasher';
import { computeAllChecksums, BANK_SIZE, PROTECTED_AREA_SIZE } from '@/lib/kwp/checksum';
import { formatHexOffset, formatSize } from '@/lib/kwp/bin';
import { cn } from '@/lib/utils';

export function ChecksumPanel() {
  const bin = useFlasher((s) => s.bin);
  const fixBinChecksums = useFlasher((s) => s.fixBinChecksums);

  const results = useMemoSafe(bin?.data);
  const badBanks = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <FileDigit className="h-5 w-5 text-primary" aria-hidden />
              Bosch CR2-Prüfsummen
            </CardTitle>
            <CardDescription>
              Jede 16-KiB-Bank endet mit zwei identischen 16-Bit-Summenwörtern (Little Endian). Die erste Bank
              (Boot/Immobilizer, {formatSize(PROTECTED_AREA_SIZE)}) ist geschützt.
            </CardDescription>
          </div>
          <Button size="sm" variant="secondary" onClick={fixBinChecksums} disabled={!bin || badBanks.length === 0}>
            <Wand2 /> Alle korrigieren
          </Button>
        </CardHeader>
        <CardContent>
          {!bin ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Kein BIN geladen – im Tab „Lesen / Schreiben“ hochladen.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge variant={badBanks.length === 0 ? 'success' : 'destructive'}>
                  {results!.length - badBanks.length} OK
                </Badge>
                {badBanks.length > 0 && <Badge variant="destructive">{badBanks.length} fehlerhaft</Badge>}
                <Badge variant="outline">{bin.kind}</Badge>
                <Badge variant="outline">{formatSize(bin.size)}</Badge>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-lg border custom-scrollbar">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Bank</th>
                      <th className="px-3 py-2 font-medium">Bereich</th>
                      <th className="px-3 py-2 font-medium">Berechnet</th>
                      <th className="px-3 py-2 font-medium">Gespeichert</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results!.map((r) => {
                      // BOOT-Label nur bei FULL-Images: bei CAL (48 KiB) ist Bank 0
                      // logisch Bank 28 des FULL-Images (0x74000) – nicht geschützt
                      const isProtected = bin?.kind === 'FULL' && r.start === 0;
                      return (
                        <tr key={r.bankIndex} className="border-t">
                          <td className="px-3 py-1.5 font-mono">
                            {r.bankIndex}
                            {isProtected && <span className="ml-1 text-[10px] text-warning">BOOT</span>}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">
                            {formatHexOffset(r.start)}–{formatHexOffset(r.end + 4)}
                          </td>
                          <td className="px-3 py-1.5 font-mono">0x{r.calculated.toString(16).toUpperCase().padStart(4, '0')}</td>
                          <td className="px-3 py-1.5 font-mono">0x{r.stored.toString(16).toUpperCase().padStart(4, '0')}</td>
                          <td className="px-3 py-1.5">
                            {r.ok ? (
                              <span className="inline-flex items-center gap-1 text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-destructive">
                                <XCircle className="h-3.5 w-3.5" aria-hidden /> FALSCH
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className={cn('mt-3 text-xs text-muted-foreground')}>
                Bankgröße: {formatSize(BANK_SIZE)} · Geschützter Bereich: {formatHexOffset(0)}–
                {formatHexOffset(PROTECTED_AREA_SIZE)}
              </p>
            </>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Hinweis: Nach Kennfeld-Änderungen (CAL) müssen nur die betroffenen Bänke neu gerechnet werden –
            „Alle korrigieren“ macht das sicher fürs gesamte Bild.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

function useMemoSafe(data: Uint8Array | undefined) {
  // bewusst ohne Hook-Abhängigkeitsprobleme: Berechnung pro Render, 32 Bänke sind billig
  if (!data) return null;
  try {
    return computeAllChecksums(data);
  } catch {
    return null;
  }
}
