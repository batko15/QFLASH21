/**
 * Supabase-REST-Fallback für das OperationLog.
 *
 * Wenn die Server-API (/api/logs) nicht verfügbar ist (z. B. ohne konfigurierte
 * DATABASE_URL auf Vercel), schreibt die App Log-Einträge direkt über die
 * Supabase-Data-API. Der Publishable Key ist dafür gedacht, im Client zu liegen.
 * Schreib-/Lesezugriff ist per RLS-Policies auf die Tabelle OperationLog beschränkt.
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://twredhbyehjxoadrbcqe.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_iR1h1fpZ9zoRe-r7RC-CmQ_ji56BU_f';

export interface OperationLogEntry {
  id: string;
  operation: string;
  status: string;
  vehicle: string | null;
  ecuType: string | null;
  details: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface NewOperationLog {
  operation: string;
  status: 'OK' | 'ERROR';
  vehicle?: string | null;
  ecuType?: string | null;
  details?: string | null;
  durationMs?: number | null;
}

function restUrl(path: string): string {
  return `${SUPABASE_URL}/rest/v1/${path}`;
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    ...extra,
  };
}

export function supabaseLogAvailable(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/** Schreibt einen Log-Eintrag direkt in Supabase. Wirft bei Fehler. */
export async function reportOperationSupabase(entry: NewOperationLog): Promise<void> {
  const res = await fetch(restUrl('OperationLog'), {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify([entry]),
  });
  if (!res.ok) {
    throw new Error(`Supabase-Log fehlgeschlagen (${res.status})`);
  }
}

/** Liest die letzten Log-Einträge (neueste zuerst). */
export async function fetchOperationLogSupabase(limit = 25): Promise<OperationLogEntry[]> {
  const url = restUrl(
    `OperationLog?select=id,operation,status,vehicle,ecuType,details,durationMs,createdAt&order=createdAt.desc&limit=${limit}`
  );
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Supabase-Log-Lesen fehlgeschlagen (${res.status})`);
  }
  return (await res.json()) as OperationLogEntry[];
}
