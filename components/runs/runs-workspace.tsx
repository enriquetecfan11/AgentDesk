'use client';

import { PlayCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RUN_STATUSES, RUN_STATUS_META, type RunStatusValue } from '@/lib/constants';
import { formatRelative } from '@/lib/dates';
import type { AgentRef, RunDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = '__all__';

/** Runs: historial de ejecuciones, con sus logs y artefactos al abrirlos. */
export function RunsWorkspace({
  initialRuns,
  agents,
  initialAgentId,
}: {
  initialRuns: RunDTO[];
  agents: AgentRef[];
  initialAgentId?: string;
}) {
  const [query, setQuery] = useState('');
  const [agentId, setAgentId] = useState<string>(initialAgentId ?? ALL);
  const [status, setStatus] = useState<string>(ALL);

  // Las filas llegan del servidor ya filtradas por agente cuando se navega con
  // `?agentId=`; los demás filtros se aplican en cliente sobre esa lista.
  const [runs, setRuns] = useState(initialRuns);
  useEffect(() => setRuns(initialRuns), [initialRuns]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return runs.filter((run) => {
      if (agentId !== ALL && run.agentId !== agentId) return false;
      if (status !== ALL && run.status !== status) return false;
      if (needle.length === 0) return true;

      return (
        (run.task?.title ?? '').toLowerCase().includes(needle) ||
        (run.agent?.name ?? '').toLowerCase().includes(needle) ||
        (run.output ?? '').toLowerCase().includes(needle) ||
        run.id.startsWith(needle)
      );
    });
  }, [runs, query, agentId, status]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Runs</h1>
          <p className="text-xs text-muted-foreground">
            {runs.length === 0 ? 'Sin ejecuciones' : `${filtered.length} de ${runs.length}`}
          </p>
        </div>

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative w-full min-w-0 sm:w-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por tarea, salida…"
              aria-label="Buscar runs"
              className="h-9 w-full pl-7 text-xs sm:h-8 sm:w-48"
            />
          </div>

          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="h-8 w-auto max-w-full gap-1.5 text-xs" aria-label="Filtrar por agente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">
                Todos los agentes
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id} className="text-xs">
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-auto max-w-full gap-1.5 text-xs" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">
                Cualquier estado
              </SelectItem>
              {RUN_STATUSES.map((value: RunStatusValue) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {RUN_STATUS_META[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <div className="max-w-md space-y-2">
            <PlayCircle className="mx-auto size-5 text-muted-foreground" />
            <h2 className="text-sm font-medium">
              {runs.length === 0 ? 'Todavía no hay runs' : 'Ninguno coincide'}
            </h2>
            <p className="text-xs text-muted-foreground">
              Un agente abre un run con <code className="font-mono">POST /api/v1/runs</code>, escribe
              en <code className="font-mono">/logs</code> y lo cierra con{' '}
              <code className="font-mono">PATCH</code>. Aquí aparecen en vivo.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {filtered.map((run) => {
              const meta = RUN_STATUS_META[run.status];

              return (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', meta.dot)} aria-hidden />
                    <span className={cn('w-20 shrink-0 text-xs', meta.text)}>{meta.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {run.task?.title ?? (
                        <span className="font-mono text-xs text-muted-foreground">{run.id.slice(0, 8)}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {run.agent?.name ?? '—'}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {run.logCount} logs
                      {run.artifactCount > 0 && ` · ${run.artifactCount} art.`}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)} s` : '—'}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelative(run.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
