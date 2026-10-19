'use client';

import { ArrowLeft, Check, Copy, Download, FileText, Loader2, Radio } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { copyText } from '@/lib/clipboard';
import { RUN_LOG_LEVEL_META, RUN_STATUS_META } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { formatRelative, formatTimestamp } from '@/lib/dates';
import type { RunDetailDTO, RunLogDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Un run, en vivo.
 *
 * El estado inicial llega del servidor y el resto por SSE: las líneas se
 * añaden según llegan y los cambios de estado recargan el run entero (son
 * pocos y traen los tiempos ya calculados en el servidor).
 */
export function RunDetailLive({ initial }: { initial: RunDetailDTO }) {
  const runId = initial.run.id;

  const [detail, setDetail] = useState(initial);
  const [logs, setLogs] = useState<RunLogDTO[]>(initial.logs);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  const seen = useRef(new Set(initial.logs.map((log) => log.id)));
  const bottom = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<RunDetailDTO>(`/api/runs/${runId}`);
      setDetail(next);
      setLogs(next.logs);
      seen.current = new Set(next.logs.map((log) => log.id));
    } catch {
      // Si falla, el siguiente evento vuelve a intentarlo.
    }
  }, [runId]);

  useEffect(() => {
    const source = new EventSource('/api/events');

    const onLog = (event: MessageEvent) => {
      const log = JSON.parse(event.data) as RunLogDTO;
      if (log.runId !== runId || seen.current.has(log.id)) return;

      seen.current.add(log.id);
      setLogs((previous) => [...previous, log]);
    };

    const onRunEvent = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { id?: string } | null;
      if (data?.id === runId) void reload();
    };

    source.addEventListener('run.log', onLog);
    source.addEventListener('run.updated', onRunEvent);
    source.addEventListener('run.artifact', onRunEvent);
    source.onerror = () => undefined;

    return () => {
      source.removeEventListener('run.log', onLog);
      source.removeEventListener('run.updated', onRunEvent);
      source.removeEventListener('run.artifact', onRunEvent);
      source.close();
    };
  }, [runId, reload]);

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, follow]);

  const run = detail.run;
  const meta = RUN_STATUS_META[run.status];
  const live = run.status === 'running' || run.status === 'queued';

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
      <div>
        <Link
          href="/runs"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Runs
        </Link>
      </div>

      <header className="flex flex-wrap items-center gap-2">
        <span className={cn('size-2.5 rounded-full', meta.dot, live && 'animate-pulse')} aria-hidden />
        <h1 className="text-base font-semibold tracking-tight">{meta.label}</h1>

        {live && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            <Radio className="size-3" />
            en vivo
          </span>
        )}

        <code className="font-mono text-[11px] text-muted-foreground">{run.id.slice(0, 8)}</code>

        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
          onClick={async () => {
            const ok = await copyText(run.id);
            setCopied(ok);
            toast[ok ? 'success' : 'error'](ok ? 'Id copiado' : 'No se pudo copiar');
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          Copiar id
        </Button>
      </header>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-xs sm:grid-cols-4">
        <Field label="Agente">
          {run.agent ? (
            <Link href={`/agents/${run.agent.id}`} className="hover:underline">
              {run.agent.name}
            </Link>
          ) : (
            '—'
          )}
        </Field>
        <Field label="Tarea">
          {run.task ? (
            <Link href={`/tasks?tarea=${run.task.id}`} className="hover:underline">
              {run.task.title}
            </Link>
          ) : (
            '—'
          )}
        </Field>
        <Field label="Inicio">{run.startedAt ? formatTimestamp(run.startedAt) : '—'}</Field>
        <Field label="Duración">
          {run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(2)} s` : '—'}
        </Field>
        <Field label="Creado">{formatRelative(run.createdAt)}</Field>
        <Field label="Fin">{run.finishedAt ? formatTimestamp(run.finishedAt) : '—'}</Field>
        <Field label="Coste">{run.costUsd !== null ? `$${run.costUsd.toFixed(4)}` : '—'}</Field>
        <Field label="Artefactos">{run.artifactCount}</Field>
      </dl>

      {run.delegationId && (
        <p className="text-[11px] text-muted-foreground">
          Ligado a la delegación <code className="font-mono">{run.delegationId.slice(0, 8)}</code>:
          al cerrarse el run se cierra con él.
        </p>
      )}

      {run.input !== null && run.input !== undefined && (
        <Section title="Entrada">
          <pre className="overflow-x-auto px-3 py-2 text-[11px] leading-relaxed">
            <code className="font-mono">{JSON.stringify(run.input, null, 2)}</code>
          </pre>
        </Section>
      )}

      {run.error && (
        <Section title="Error">
          <pre className="overflow-x-auto px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
            <code className="font-mono">{run.error}</code>
          </pre>
        </Section>
      )}

      {run.output && (
        <Section title="Salida">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px] leading-relaxed">
            <code className="font-mono">{run.output}</code>
          </pre>
        </Section>
      )}

      <Section
        title="Logs"
        description={`${logs.length} líneas`}
        action={
          <div className="flex items-center gap-2">
            <Checkbox
              id="follow-logs"
              checked={follow}
              onCheckedChange={(checked) => setFollow(checked === true)}
            />
            <Label htmlFor="follow-logs" className="text-[11px] font-normal text-muted-foreground">
              Seguir
            </Label>
          </div>
        }
      >
        <div className="max-h-96 overflow-y-auto bg-muted/20 px-3 py-2">
          {logs.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {live ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  Esperando las primeras líneas…
                </span>
              ) : (
                'Este run no dejó logs.'
              )}
            </p>
          ) : (
            <ol className="space-y-0.5">
              {logs.map((log) => (
                <li key={log.id} className="flex items-baseline gap-2 text-[11px] leading-relaxed">
                  <time
                    dateTime={log.createdAt}
                    className="shrink-0 font-mono text-muted-foreground/70"
                  >
                    {log.createdAt.slice(11, 19)}
                  </time>
                  <span
                    className={cn('w-10 shrink-0 font-mono', RUN_LOG_LEVEL_META[log.level].text)}
                  >
                    {log.level}
                  </span>
                  <span className="whitespace-pre-wrap break-words font-mono">{log.message}</span>
                </li>
              ))}
            </ol>
          )}
          <div ref={bottom} />
        </div>
      </Section>

      {detail.artifacts.length > 0 && (
        <Section title="Artefactos" description={`${detail.artifacts.length}`}>
          <ul className="divide-y divide-border">
            {detail.artifacts.map((artifact) => (
              <li key={artifact.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{artifact.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {artifact.kind}
                  {artifact.sizeBytes !== null && ` · ${formatBytes(artifact.sizeBytes)}`}
                </span>
                {artifact.downloadUrl ? (
                  <a
                    href={artifact.downloadUrl}
                    download
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Download className="size-3.5" />
                    Descargar
                  </a>
                ) : (
                  <a
                    href={`/api/artifacts/${artifact.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Ver
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
