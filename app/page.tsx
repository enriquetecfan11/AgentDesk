import { CheckCircle2, Database, Server } from 'lucide-react';

import { getSql } from '@/lib/db/client';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Fase 1 landing page: proves the container is up and the database is reachable
 * from another device on the LAN. Replaced by the real app shell in Fase 2.
 */
export default async function Page() {
  const env = getEnv();

  let dbOk = true;
  let dbError: string | null = null;

  try {
    await getSql()`select 1`;
  } catch (error) {
    dbOk = false;
    dbError = error instanceof Error ? error.message : 'error desconocido';
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          AgentDesk
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Esqueleto operativo</h1>
        <p className="text-sm text-muted-foreground">
          Fase 1 completada. Los datos viven en Postgres 16 dentro de la red de Docker.
        </p>
      </header>

      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <Row icon={<Server className="size-4" />} label="APP_BASE_URL" value={env.APP_BASE_URL} />
        <Row
          icon={<Database className="size-4" />}
          label="Base de datos"
          value={dbOk ? 'conectada' : `error: ${dbError}`}
          status={dbOk ? 'ok' : 'error'}
        />
      </dl>

      <p className="text-xs text-muted-foreground">
        Healthcheck máquina: <code className="font-mono">GET /api/health</code>
      </p>
    </main>
  );
}

function Row({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: 'ok' | 'error';
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-muted-foreground">{icon}</span>
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 font-mono text-sm">
        <span className="truncate">{value}</span>
        {status === 'ok' && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
      </dd>
    </div>
  );
}
