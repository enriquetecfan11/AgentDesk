'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { TasksView } from '@/components/tasks/tasks-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { PROJECT_STATUS_META } from '@/lib/constants';
import { formatDueLabel } from '@/lib/dates';
import type { LabelDTO, Milestone, ProjectDTO, TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ProjectWorkspace({
  project: initialProject,
  initialTasks,
  projects,
  labels,
}: {
  project: ProjectDTO;
  initialTasks: TaskDTO[];
  projects: ProjectDTO[];
  labels: LabelDTO[];
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [draftMilestone, setDraftMilestone] = useState('');

  useEffect(() => {
    setProject(initialProject);
  }, [initialProject]);

  async function saveMilestones(milestones: Milestone[]) {
    const snapshot = project;
    setProject({ ...project, milestones });

    try {
      const { project: updated } = await api.patch<{ project: ProjectDTO }>(
        `/api/projects/${project.id}`,
        { milestones },
      );
      setProject(updated);
      router.refresh();
    } catch (error) {
      setProject(snapshot);
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar los hitos');
    }
  }

  function addMilestone(event: React.FormEvent) {
    event.preventDefault();
    const title = draftMilestone.trim();
    if (!title) return;
    setDraftMilestone('');
    void saveMilestones([...project.milestones, { title, done: false, date: null }]);
  }

  const pct =
    project.taskTotal > 0 ? Math.round((project.taskDone / project.taskTotal) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-4 border-b border-border px-4 py-5 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="size-3 rounded-[4px]"
                style={{ background: project.color ?? 'hsl(var(--muted-foreground))' }}
              />
              {project.identifier && (
                <span className="font-mono text-xs uppercase text-muted-foreground">
                  {project.identifier}
                </span>
              )}
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {PROJECT_STATUS_META[project.status].label}
              </span>
            </div>

            <h2 className="truncate text-lg font-semibold tracking-tight">{project.name}</h2>

            {project.description && (
              <p className="max-w-2xl text-sm text-muted-foreground">{project.description}</p>
            )}
          </div>

          <div className="w-full max-w-56 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {project.taskDone}/{project.taskTotal} tareas
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progreso del proyecto"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            {project.targetDate && (
              <p className="text-xs text-muted-foreground">
                Objetivo: {formatDueLabel(project.targetDate)}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Hitos
          </h3>

          <ul className="space-y-0.5">
            {project.milestones.map((milestone, index) => (
              <li key={`${milestone.title}-${index}`} className="group flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    saveMilestones(
                      project.milestones.map((item, position) =>
                        position === index ? { ...item, done: !item.done } : item,
                      ),
                    )
                  }
                  className="grid size-7 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={
                    milestone.done
                      ? `Marcar «${milestone.title}» como pendiente`
                      : `Completar «${milestone.title}»`
                  }
                >
                  {milestone.done ? (
                    <span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  ) : (
                    <span className="size-4 rounded-full border border-muted-foreground/50" />
                  )}
                </button>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    milestone.done && 'text-muted-foreground line-through',
                  )}
                >
                  {milestone.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() =>
                    saveMilestones(
                      project.milestones.filter((_, position) => position !== index),
                    )
                  }
                  aria-label={`Eliminar hito «${milestone.title}»`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>

          <form onSubmit={addMilestone} className="flex max-w-md items-center gap-2">
            <Plus className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={draftMilestone}
              onChange={(event) => setDraftMilestone(event.target.value)}
              placeholder="Añadir hito"
              className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
              aria-label="Nuevo hito"
            />
          </form>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <TasksView
          initialTasks={initialTasks}
          projects={projects}
          initialLabels={labels}
          defaultProjectId={project.id}
          showProject={false}
        />
      </div>
    </div>
  );
}
