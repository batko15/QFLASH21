import { PrismaClient } from '@prisma/client';

/**
 * Datenbank-URL mit Fallback-Kette:
 * - DATABASE_URL          (Standard, eigene Env)
 * - POSTGRES_PRISMA_URL   (Supabase↔Vercel-Integration, pooled)
 * - POSTGRES_URL          (Supabase↔Vercel-Integration, direkt)
 */
export function databaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    undefined
  );
}

export function hasDatabase(): boolean {
  return Boolean(databaseUrl());
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient(): PrismaClient {
  const url = databaseUrl();
  if (!url) {
    // App läuft ohne DB weiter (Graceful Degradation) – Queries werfen erst dann.
    return new PrismaClient({ log: ['warn', 'error'] });
  }
  return new PrismaClient({
    datasourceUrl: url,
    log: ['warn', 'error'],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
