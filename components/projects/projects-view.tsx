'use client';

import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ProjectDialog, type ProjectFormValues } from '@/components/projects/project-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api-client';
import { PROJECT_STATUS_META } from '@/lib/constants';
import type { ProjectDTO } from '@/lib/types';

export function ProjectsView({ initialProjects }: { initialProjects: ProjectDTO[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectDTO | null>(null);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  async function createProject(values: ProjectFormValues) {
    try {
      const { project } = await api.post<{ project: ProjectDTO }>('/api/projects', values);
      setProjects((previous) => [...previous, project]);
      toast.success('Proyecto creado');
      router.refresh();
      return project;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el proyecto');
      return null;
    }
  }

  async function saveProject(values: ProjectFormValues) {
    if (!editing) return null;
    try {
      const { project } = await api.patch<{ project: ProjectDTO }>(
        `/api/projects/${editing.id}`,
        values,
      );
      setProjects((previous) =>
        previous.map((item) => (item.id === project.id ? project : item)),
      );
      toast.success('Proyecto actualizado');
      router.refresh();
      return project;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el proyecto');
      return null;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);

    const snapshot = projects;
    setProjects((previous) => previous.filter((item) => item.id !== target.id));

    try {
      await api.del(`/api/projects/${target.id}`);
      toast.success(`Proyecto «${target.name}» eliminado`);
      router.refresh();
    } catch (error) {
      setProjects(snapshot);
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
    }
  }

  return (
    <div className="px-3 py-4 md:px-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {projects.length === 0
            ? 'Sin proyectos todavía'
            : `${projects.length} ${projects.length === 1 ? 'proyecto' : 'proyectos'}`}
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setComposerOpen(true)}>
          <Plus className="size-4" />
          Nuevo proyecto
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <div className="max-w-sm space-y-2">
            <h2 className="text-sm font-medium">Crea tu primer proyecto</h2>
            <p className="text-sm text-muted-foreground">
              Un proyecto agrupa tareas, notas e hitos bajo un mismo objetivo. Las tareas sin
              proyecto viven sueltas y aparecen en el Inbox.
            </p>
            <Button size="sm" className="mt-1 gap-1.5" onClick={() => setComposerOpen(true)}>
              <Plus className="size-4" />
              Nuevo proyecto
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const pct =
              project.taskTotal > 0
                ? Math.round((project.taskDone / project.taskTotal) * 100)
                : 0;

            return (
              <li key={project.id}>
                <div className="group relative rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring/40">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-0.5 size-3 shrink-0 rounded-[4px]"
                      style={{ background: project.color ?? 'hsl(var(--muted-foreground))' }}
                    />
                    <Link
                      href={`/projects/${project.id}`}
                      className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <h3 className="truncate text-sm font-medium">{project.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {project.identifier ? `${project.identifier} · ` : ''}
                        {PROJECT_STATUS_META[project.status].label}
                      </p>
                    </Link>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Acciones de ${project.name}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2" onClick={() => setEditing(project)}>
                          <Pencil className="size-3.5" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-destructive"
                          onClick={() => setPendingDelete(project)}
                        >
                          <Trash2 className="size-3.5" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {project.description && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {project.description}
                    </p>
                  )}

                  <div className="mt-3 space-y-1.5">
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
                      aria-label={`Progreso de ${project.name}`}
                    >
                      <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ProjectDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onSubmit={createProject}
      />

      <ProjectDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        project={editing}
        onSubmit={saveProject}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{pendingDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Las tareas del proyecto no se borran: se quedan sin proyecto. Esta acción no se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
