import Link from 'next/link';
import { Database, ShieldCheck, UserRound } from 'lucide-react';

import { WebhooksSettings } from '@/components/webhooks/webhooks-settings';
import { requireUser } from '@/lib/auth/session';
import { getBaseUrl } from '@/lib/base-url';
import { PASSWORD_MIN_LENGTH } from '@/lib/constants';
import { countLabels } from '@/lib/domain/labels';
import { countProjects } from '@/lib/domain/projects';
import { countTasks } from '@/lib/domain/tasks';
import { listWebhooks } from '@/lib/domain/webhooks';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const env = getEnv();
  const baseUrl = await getBaseUrl();

  // Counts, not lists: this screen shows numbers, so counting in SQL avoids
  // loading every task (with its labels and project) just to read `.length`.
  const [taskCount, projectCount, labelCount, webhooks] = await Promise.all([
    countTasks(),
    countProjects(),
    countLabels(),
    listWebhooks(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <UserRound className="size-4 text-muted-foreground" />
          Usuario
        </h2>
        <dl className="divide-y divide-border rounded-lg border border-border text-sm">
          <Row label="Nombre" value={user.name} />
          <Row label="Email" value={user.email} />
          <Row label="Contraseña" value={`mínimo ${PASSWORD_MIN_LENGTH} caracteres (Argon2id)`} />
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Database className="size-4 text-muted-foreground" />
          Contenido
        </h2>
        <dl className="divide-y divide-border rounded-lg border border-border text-sm">
          <Row label="Tareas" value={String(taskCount)} />
          <Row label="Proyectos" value={String(projectCount)} />
          <Row label="Etiquetas" value={String(labelCount)} />
        </dl>
      </section>

      <WebhooksSettings initialWebhooks={webhooks} />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Instalación
        </h2>
        <dl className="divide-y divide-border rounded-lg border border-border text-sm">
          <Row label="URL base" value={env.APP_BASE_URL} mono />
          {env.APP_EXTRA_ORIGINS.length > 0 && (
            <Row label="Otras URLs" value={env.APP_EXTRA_ORIGINS.join(', ')} mono />
          )}
          {baseUrl !== env.APP_BASE_URL && (
            <Row label="Estás entrando por" value={baseUrl} mono />
          )}
          <Row label="Directorio de subidas" value={env.UPLOADS_DIR} mono />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
            <dt className="text-muted-foreground">Documentación de la API</dt>
            <dd>
              <Link href="/docs" className="text-sm underline underline-offset-4">
                Abrir documentación
              </Link>
            </dd>
          </div>
          <Row label="Especificación de la API" value="/api/openapi.json" mono />
          <Row label="Entorno" value={env.NODE_ENV} mono />
        </dl>
        <p className="text-xs text-muted-foreground">
          Todo se ejecuta en tu propia máquina. No hay servicios externos ni telemetría.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? 'min-w-0 break-words font-mono text-xs sm:text-right'
            : 'min-w-0 break-words sm:text-right'
        }
      >
        {value}
      </dd>
    </div>
  );
}
