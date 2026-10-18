import {
  Bot,
  CircleDot,
  FileText,
  FolderKanban,
  ListChecks,
  LogIn,
  NotebookPen,
  PlayCircle,
  Send,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';

import { requireUser } from '@/lib/auth/session';
import { listActivity } from '@/lib/domain/activity';
import { formatRelative } from '@/lib/dates';
import type { ActivityDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  'user.created': 'creó la cuenta',
  'user.signed_in': 'inició sesión',
  'project.created': 'creó el proyecto',
  'project.updated': 'actualizó el proyecto',
  'project.deleted': 'eliminó el proyecto',
  'task.created': 'creó la tarea',
  'task.updated': 'actualizó la tarea',
  'task.status_changed': 'cambió el estado de',
  'task.recurred': 'reprogramó la tarea',
  'task.deleted': 'eliminó la tarea',
  'task.comment': 'comentó en la tarea',
  'label.created': 'creó la etiqueta',
  'note.created': 'escribió la nota',
  'note.updated': 'actualizó la nota',
  'note.renamed': 'renombró la nota',
  'note.deleted': 'eliminó la nota',
  'note.imported': 'importó notas',
  'agent.created': 'creó el agente',
  'agent.updated': 'actualizó el agente',
  'agent.deleted': 'eliminó el agente',
  'agent.token_created': 'emitió un token para',
  'agent.token_revoked': 'revocó un token de',
  'agent.token_deleted': 'borró un token de',
  'delegation.created': 'delegó en un agente:',
  'delegation.approved': 'aprobó la delegación',
  'delegation.accepted': 'aceptó la delegación',
  'delegation.in_progress': 'empezó la delegación',
  'delegation.completed': 'completó la delegación',
  'delegation.failed': 'falló la delegación',
  'delegation.rejected': 'rechazó la delegación',
  'delegation.cancelled': 'canceló la delegación',
  'run.started': 'abrió un run',
  'run.queued': 'encoló un run',
  'run.running': 'puso en marcha un run',
  'run.succeeded': 'terminó un run',
  'run.failed': 'falló un run',
  'run.cancelled': 'canceló un run',
  'artifact.created': 'adjuntó un artefacto',
};

function iconFor(entry: ActivityDTO) {
  if (entry.action.startsWith('project.')) return FolderKanban;
  if (entry.action.startsWith('task.')) return ListChecks;
  if (entry.action.startsWith('label.')) return Tag;
  if (entry.action.startsWith('note.')) return NotebookPen;
  if (entry.action.startsWith('agent.')) return Bot;
  if (entry.action.startsWith('delegation.')) return Send;
  if (entry.action.startsWith('run.')) return PlayCircle;
  if (entry.action.startsWith('artifact.')) return FileText;
  if (entry.action === 'user.signed_in') return LogIn;
  if (entry.action === 'user.created') return UserRound;
  return CircleDot;
}

function detailFor(entry: ActivityDTO): string | null {
  const meta = entry.meta ?? {};
  const title = typeof meta.title === 'string' ? meta.title : null;
  const name = typeof meta.name === 'string' ? meta.name : null;
  const body = typeof meta.body === 'string' ? meta.body : null;

  if (entry.action === 'task.deleted' || entry.action === 'project.deleted') return null;
  if (entry.action === 'task.comment') return body ? truncate(body, 90) : null;
  if (entry.action.startsWith('task.')) return title;
  if (entry.action.startsWith('project.') || entry.action.startsWith('label.')) return name;
  if (entry.action.startsWith('note.')) return title;
  if (entry.action.startsWith('agent.')) return name;
  if (entry.action.startsWith('delegation.')) return title;
  if (entry.action.startsWith('run.')) return title;
  if (entry.action.startsWith('artifact.')) return name;
  return null;
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Lo que hace un agente interesa distinto a lo que hace una persona. */
const ACTOR_FILTERS = [
  { value: 'all', label: 'Todo' },
  { value: 'human', label: 'Personas' },
  { value: 'agent', label: 'Agentes' },
] as const;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string }>;
}) {
  await requireUser();

  const { actor } = await searchParams;
  const selected = ACTOR_FILTERS.some((filter) => filter.value === actor) ? actor : 'all';

  const all = await listActivity(300);
  const entries = selected === 'all' ? all : all.filter((entry) => entry.actorType === selected);

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Actividad</h1>
          <p className="text-xs text-muted-foreground">
            {selected === 'all' ? 'Todo el workspace' : ACTOR_FILTERS.find((f) => f.value === selected)?.label}
            {' · '}
            {entries.length} entradas
          </p>
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Filtrar por autor">
          {ACTOR_FILTERS.map((filter) => (
            <Link
              key={filter.value}
              href={filter.value === 'all' ? '/activity' : `/activity?actor=${filter.value}`}
              aria-current={selected === filter.value}
              className={cn(
                'rounded-md px-2 py-1 text-xs',
                selected === filter.value
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
      </header>

      {entries.length === 0 ? (
        <div className="grid place-items-center px-6 py-24 text-center">
          <div className="max-w-md space-y-2">
            <h2 className="text-base font-semibold tracking-tight">Todavía no hay actividad</h2>
            <p className="text-sm text-muted-foreground">
              Aquí se registra todo lo que pasa en el workspace: humanos y agentes en la misma
              cronología.
            </p>
          </div>
        </div>
      ) : (
        <ol className="space-y-0">
          {entries.map((entry, index) => {
            const Icon = iconFor(entry);
            const detail = detailFor(entry);
            const label = ACTION_LABELS[entry.action] ?? entry.action;

            return (
              <li key={entry.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-full border bg-card',
                      entry.actorType === 'agent' ? 'border-accent/40' : 'border-border',
                    )}
                  >
                    <Icon className="size-3.5 text-muted-foreground" />
                  </span>
                  {index < entries.length - 1 && <span className="w-px flex-1 bg-border" />}
                </div>

                <div className="min-w-0 flex-1 pb-5 pt-0.5">
                  <p className="text-sm">
                    <span className="font-medium">{entry.actorName}</span>{' '}
                    <span className="text-muted-foreground">{label}</span>
                    {detail && <span className="text-muted-foreground"> «{detail}»</span>}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <time dateTime={entry.createdAt}>{formatRelative(entry.createdAt)}</time>
                    {entry.actorType === 'agent' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5">
                        <Bot className="size-3" />
                        agente
                      </span>
                    )}
                    {entry.action === 'task.deleted' && <Trash2 className="size-3" aria-hidden />}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
