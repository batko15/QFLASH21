import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Datenbank nicht konfiguriert (DATABASE_URL fehlt)', degraded: true },
      { status: 503 }
    );
  }
  try {
    const body = await req.json();
    const operation = String(body.operation ?? '').slice(0, 64);
    if (!operation) {
      return NextResponse.json({ error: 'operation fehlt' }, { status: 400 });
    }
    const status = body.status === 'ERROR' ? 'ERROR' : 'OK';
    const entry = await db.operationLog.create({
      data: {
        operation,
        status,
        vehicle: body.vehicle != null ? String(body.vehicle).slice(0, 64) : null,
        ecuType: body.ecuType != null ? String(body.ecuType).slice(0, 128) : null,
        details: body.details != null ? JSON.stringify(body.details).slice(0, 4000) : null,
        durationMs: typeof body.durationMs === 'number' ? Math.round(body.durationMs) : null,
      },
    });
    return NextResponse.json({ id: entry.id, ok: true }, { status: 201 });
  } catch (e) {
    console.error('[api/logs POST]', e);
    return NextResponse.json({ error: 'Log konnte nicht gespeichert werden' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Datenbank nicht konfiguriert (DATABASE_URL fehlt)', degraded: true, logs: [], stats: [] },
      { status: 503 }
    );
  }
  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = Math.min(Math.max(Number(limitParam ?? 50), 1), 200);
    const logs = await db.operationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const stats = await db.operationLog.groupBy({
      by: ['operation', 'status'],
      _count: { _all: true },
    });
    return NextResponse.json({ logs, stats });
  } catch (e) {
    console.error('[api/logs GET]', e);
    return NextResponse.json({ error: 'Logs konnten nicht geladen werden' }, { status: 500 });
  }
}
