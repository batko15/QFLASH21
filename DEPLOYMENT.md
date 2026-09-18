# QFLASH21 Deployment-Anleitung (Vercel + Supabase)

Stand: vollständig eingerichtet. Dieses Dokument beschreibt die Produktiv-Umgebung
und die manuellen Schritte, die nur im Dashboard möglich sind.

## Übersicht

| Komponente | Dienst | Link |
|---|---|---|
| Frontend + API | Vercel (Projekt `qflashk`) | https://qflashk-git-main-batko15s-projects.vercel.app |
| Datenbank | Supabase Postgres (Region `ap-southeast-2`) | https://supabase.com/dashboard/project/twredhbyehjxoadrbcqe |
| Code | GitHub `batko15/QFLASH21` (branch `main`) | https://github.com/batko15/QFLASH21 |

- **Jeder Push auf `main`** triggert automatisch ein Vercel-Deployment (Build: `prisma generate && next build`).
- Prisma nutzt zwei Verbindungen:
  - `DATABASE_URL` → **PgBouncer-Transaction-Pooler** (Port 6543, `?pgbouncer=true`) – Runtime (Serverless-safe)
  - `DIRECT_URL` → **Session-Pooler** (Port 5432) – nur für `prisma db push` / Migrationen

## 1. Supabase-Datenbank (erledigt ✅)

Schema wurde mit `bun run db:push` deployed (Tabelle `OperationLog`).

```bash
bun run db:push   # bei Schema-Änderungen erneut ausführen
```

## 2. Vercel-Umgebungsvariablen

⚠️ **Einmalig im Vercel-Dashboard setzen** (nur dort möglich – API-Token lag nicht vor):

Dashboard → Projekt `qflashk` → **Settings → Environment Variables** → für *Production, Preview, Development*:

| Name | Wert |
|---|---|
| `DATABASE_URL` | `postgresql://postgres.twredhbyehjxoadrbcqe:<DB-PASSWORT>@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5` |
| `DIRECT_URL` | `postgresql://postgres.twredhbyehjxoadrbcqe:<DB-PASSWORT>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres` |

(DB-Passwort siehe Supabase → Project Settings → Database. Nicht in Git committen!)

Danach **Deployments → Redeploy** (oder nächsten Push abwarten).

## 3. Deployment Protection (wichtig für Handy-Nutzung!)

Die Branch-URL (`…-git-main-…vercel.app`) ist durch **Vercel-SSO geschützt** (302 → Login).
Die **Produktions-URL `https://qflashk.vercel.app`** ist öffentlich – dort die PWA installieren.

Falls auch die Produktions-URL einen Login zeigt:
**Settings → Deployment Protection → Vercel Authentication = Disabled** (nur `Only Preview Deployments` aktiv lassen).

## 4. Verifikation nach dem Deploy

```bash
curl -s https://qflashk.vercel.app/api/logs?limit=1
# Erwartet: {"logs":[...],"stats":[...]}
# {"error":"Datenbank nicht konfiguriert…"} → Env-Vars fehlen (Schritt 2)
```

App prüfen: https://qflashk.vercel.app → Tab „Verbindung“ → „Simulator starten“ → Ident/DTC lesen.

## 5. Android installieren

1. `https://qflashk.vercel.app` in Chrome öffnen
2. Menü ⋮ → **„App installieren“** (oder Install-Button im App-Header)
3. Icon erscheint auf dem Homescreen → Vollbild-PWA

## Lokale Entwicklung

```bash
bun install
cp .env.example .env   # Werte aus Supabase eintragen
bun run db:push
bun run dev            # ACHTUNG: falls DATABASE_URL in der Shell gesetzt ist,
                       # mit `env -u DATABASE_URL -u DIRECT_URL bun run dev` starten
```
