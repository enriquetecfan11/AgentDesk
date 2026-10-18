'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, FolderKanban, Inbox as InboxIcon, ListTodo, Loader2, Trash2 } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { CaptureBox } from '@/components/tasks/capture-box';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { TaskRow } from '@/components/tasks/task-row';
import { createProject, createTask, deleteTask, listProjects, listTasks, updateTask } from '@/lib/api';
import type { TaskWithRefs } from '@/lib/types';
import { cn } from '@/lib/utils';

export function InboxView() {
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [convertTo, setConvertTo] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [busy, setBusy] = useState(false);

  const searchParams = useSearchParams();
  const captureOpen = searchParams.get('capture') === '1';
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await listTasks({ inboxOnly: true, includeDone: true });
      setTasks(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toTask = async (id: string) => {
    await updateTask(id, { status: 'backlog' });
    router.refresh();
    load();
  };

  const toProject = async (id: string) => {
    if (!projectName.trim() || busy) return;
    setBusy(true);
    try {
      const task = tasks.find((t) => t.id === id);
      const project = await createProject({ name: projectName.trim() });
      await createTask({
        title: 'Definir alcance',
        project_id: project.id,
        status: 'backlog',
      });
      if (task) {
        await createTask({
          title: task.title,
          project_id: project.id,
          description: 'Idea original desde Inbox',
          status: 'backlog',
        });
      }
      await deleteTask(id);
      setConvertTo(null);
      setProjectName('');
      router.refresh();
      load();
    } finally {
      setBusy(false);
    }
  };

  const archive = async (id: string) => {
    await updateTask(id, { status: 'done' });
    load();
  };

  const remove = async (id: string) => {
    await deleteTask(id);
    load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar title="Inbox" subtitle={`${tasks.length} capturas`} />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <CaptureBox autoFocus={captureOpen} placeholder="Capturar idea (Enter para añadir)…" />

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <InboxIcon className="h-8 w-8" />
              <p className="text-sm">Inbox vacío. Todo capturado está procesado.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((t) => (
                <div key={t.id} className="group">
                  <div className="flex items-center gap-1 rounded-md border border-border bg-card">
                    <div className="min-w-0 flex-1">
                      <TaskRow task={t} showProject={false} />
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Convertir en tarea activa" onClick={() => toTask(t.id)}>
                        <ListTodo className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Convertir en proyecto" onClick={() => setConvertTo(t.id)}>
                        <FolderKanban className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Archivar" onClick={() => archive(t.id)}>
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Eliminar" onClick={() => remove(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {convertTo === t.id && (
                    <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-[hsl(var(--ring))] bg-muted p-2">
                      <input
                        autoFocus
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') toProject(t.id); if (e.key === 'Escape') setConvertTo(null); }}
                        placeholder="Nombre del nuevo proyecto"
                        className="flex-1 rounded border border-input bg-card px-2.5 py-1.5 text-[13px] outline-none"
                      />
                      <Button size="sm" className="h-8 gap-1.5" disabled={busy || !projectName.trim()} onClick={() => toProject(t.id)}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderKanban className="h-3.5 w-3.5" />}
                        Crear
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setConvertTo(null)}>
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
