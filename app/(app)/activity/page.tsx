import {
  Bot,
  CircleDot,
  FolderKanban,
  ListChecks,
  LogIn,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react';

import { requireUser } from '@/lib/auth/session';
import { listActivity } from '@/lib/domain/activity';
import { formatRelative } from '@/lib/dates';
import type { ActivityDTO } from '@/lib/types';

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
  'task.deleted': 'eliminó la tarea',
  'label.created': 'creó la etiqueta',
};

function iconFor(entry: ActivityDTO) {
  if (entry.action.startsWith('project.')) return FolderKanban;
  if (entry.action.startsWith('task.')) return ListChecks;
  if (entry.action.startsWith('label.')) return Tag;
  if (entry.action === 'user.signed_in') return LogIn;
  if (entry.action === 'user.created') return UserRound;
  return CircleDot;
}

function detailFor(entry: ActivityDTO): string | null {
  const meta = entry.meta ?? {};
  const title = typeof meta.title === 'string' ? meta.title : null;
  const name = typeof meta.name === 'string' ? meta.name : null;
  if (entry.action === 'task.deleted' || entry.action === 'project.deleted') return null;
  if (entry.action.startsWith('task.')) return title;
  if (entry.action.startsWith('project.') || entry.action.startsWith('label.')) return name;
  return null;
}

export default async function ActivityPage() {
  await requireUser();
  const entries = await listActivity();

  if (entries.length === 0) {
    return (
      <div className="grid place-items-center px-6 py-24 text-center">
        <div className="max-w-md space-y-2">
          <h2 className="text-base font-semibold tracking-tight">Todavía no hay actividad</h2>
          <p className="text-sm text-muted-foreground">
            Aquí se registra todo lo que pasa en el workspace: humanos y agentes en la misma
            cronología.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <ol className="space-y-0">
        {entries.map((entry, index) => {
          const Icon = iconFor(entry);
          const detail = detailFor(entry);
          const label = ACTION_LABELS[entry.action] ?? entry.action;

          return (
            <li key={entry.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card">
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
                  {entry.action === 'task.deleted' && (
                    <Trash2 className="size-3" aria-hidden />
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
