/**
 * QFLASH21 v2.3.0 – Native-API-Adapter (App-Modus).
 *
 * In der Standalone-Android-App (v2.3.0) läuft KEIN HTTP-Server mehr: Assets
 * werden per shouldInterceptRequest aus der APK bedient und die beiden
 * API-Endpunkte (/api/logs, /api/analyze-dtc) laufen synchron über die
 * JavaScript-Brücke `window.QfNativeApi` (Klasse QfNativeApi der APK), weil
 * shouldInterceptRequest den POST-Body nicht bereitstellt.
 *
 * Reihenfolge überall: Native-Brücke → /api/* (Website) → Supabase/Offline.
 */

/** Rohform der nativen Brücke (implementiert in apk-src/.../QfNativeApi.java). */
export interface QfNativeApiRaw {
  postOperationLog(json: string): string;
  getOperationLogs(limit: number): string;
  analyzeDtc(json: string): string;
  saveAssetToDownloads(assetPath: string, displayName: string): string;
  appInfo(): string;
  consoleTail(): string;
  copyToClipboard(text: string): boolean;
}

declare global {
  interface Window {
    QfNativeApi?: QfNativeApiRaw;
  }
}

/** true, wenn die Web-Oberfläche in der Standalone-App läuft (Brücke vorhanden). */
export function isNativeApi(): boolean {
  if (typeof window === 'undefined') return false;
  const api = window.QfNativeApi;
  return (
    !!api &&
    typeof api.postOperationLog === 'function' &&
    typeof api.getOperationLogs === 'function'
  );
}

/** Diagnose-Infos der nativen Seite (null auf der Website). */
export function nativeAppInfo(): Record<string, unknown> | null {
  try {
    if (!window.QfNativeApi) return null;
    return JSON.parse(window.QfNativeApi.appInfo()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* --------------------------- Operationshistorie --------------------------- */

export interface NativeLogEntry {
  id: string;
  operation: string;
  status: 'OK' | 'ERROR';
  vehicle?: string | null;
  ecuType?: string | null;
  details?: string | null;
  durationMs?: number | null;
  createdAt: string;
}

export interface NativeLogResult {
  logs: NativeLogEntry[];
  stats: Array<{ operation: string; status: string; _count: { _all: number } }>;
}

/** Operations-Log melden: erst nativ (App), dann HTTP (Website). */
export async function reportOperationLog(entry: {
  operation: string;
  status: 'OK' | 'ERROR';
  details?: unknown;
  durationMs?: number;
  vehicle?: string;
  ecuType?: string;
}): Promise<boolean> {
  // 1) Native App: synchroner Brücken-Call, kein Netzwerk
  try {
    if (isNativeApi()) {
      const res = window.QfNativeApi!.postOperationLog(JSON.stringify(entry));
      const parsed = JSON.parse(res) as { ok?: boolean; error?: string };
      if (parsed.ok) return true;
      return false; // nativer Fehler → kein HTTP-Fallback sinnvoll, caller entscheidet
    }
  } catch {
    // Brücken-Fehler → weiter zum HTTP-Weg
  }
  // 2) Website: HTTP-API
  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Operations-Log lesen: erst nativ (App), dann HTTP (Website). */
export async function fetchOperationLogs(limit = 25): Promise<NativeLogResult | null> {
  // 1) Native App
  try {
    if (isNativeApi()) {
      const res = window.QfNativeApi!.getOperationLogs(limit);
      const parsed = JSON.parse(res) as NativeLogResult & { error?: string };
      if (!parsed.error) return { logs: parsed.logs ?? [], stats: parsed.stats ?? [] };
      return null;
    }
  } catch {
    // weiter zum HTTP-Weg
  }
  // 2) Website
  try {
    const res = await fetch(`/api/logs?limit=${limit}`);
    if (res.ok) {
      const data = (await res.json()) as NativeLogResult;
      return { logs: data.logs ?? [], stats: data.stats ?? [] };
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------ DTC-Analyse ------------------------------- */

export interface DtcHintInput {
  code: string;
  description?: string;
  statusText?: string;
  sporadic?: boolean;
}

/** DTC-Analyse: erst nativ (App), dann HTTP (Website). */
export async function analyzeDtcHints(
  dtcs: DtcHintInput[]
): Promise<{ analysis: string; source: string } | null> {
  // 1) Native App
  try {
    if (isNativeApi()) {
      const res = window.QfNativeApi!.analyzeDtc(JSON.stringify({ dtcs }));
      const parsed = JSON.parse(res) as { analysis?: string; source?: string; error?: string };
      if (!parsed.error && typeof parsed.analysis === 'string') {
        return { analysis: parsed.analysis, source: parsed.source ?? 'fallback' };
      }
      return null;
    }
  } catch {
    // weiter zum HTTP-Weg
  }
  // 2) Website
  try {
    const res = await fetch('/api/analyze-dtc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dtcs }),
    });
    if (res.ok) return (await res.json()) as { analysis: string; source: string };
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------- Downloads -------------------------------- */

/**
 * Konfigs-ZIP in der App nativ nach Downloads/ kopieren (kein DownloadManager,
 * kein Netz). Rückgabe: true = nativ gestartet; false = Website (normales
 * <a download> verwenden).
 */
export function saveKonfigsZipNatively(assetPath: string, displayName: string): boolean {
  try {
    if (!isNativeApi()) return false;
    const res = window.QfNativeApi!.saveAssetToDownloads(assetPath, displayName);
    const parsed = JSON.parse(res) as { ok?: boolean };
    return !!parsed.ok;
  } catch {
    return false;
  }
}
