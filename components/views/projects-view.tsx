'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Archive, FolderKanban, Loader2, Plus } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { BadgeDot } from '@/components/ui/badge-dot';
import { createProject, listProjects, listTasks, updateProject } from '@/lib/api';
import type { Project, TaskWithRefs } from '@/lib/types';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#6366f1', '#ec4899', '#84cc16'];

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([listProjects(), listTasks({ includeDone: true })]);
      setProjects(p);
      setTasks(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const project = await createProject({ name: name.trim(), color });
      setName('');
      setCreating(false);
      router.push(`/projects/${project.id}`);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (id: string) => {
    await updateProject(id, { status: 'archived', archived_at: new Date().toISOString() });
    load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar
        title="Proyectos"
        subtitle={`${projects.length} activos`}
        actions={
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setCreating((c) => !c)}>
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {creating && (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <Input
                autoFocus
                placeholder="Nombre del proyecto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
              />
              <div className="flex items-center gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="h-5 w-5 rounded-full border-2"
                    style={{ background: c, borderColor: color === c ? 'hsl(var(--foreground))' : 'transparent' }}
                    aria-label={`Color ${c}`}
                  />
                ))}
                <Button size="sm" className="ml-auto h-8 gap-1.5" disabled={busy || !name.trim()} onClick={create}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderKanban className="h-3.5 w-3.5" />}
                  Crear proyecto
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <FolderKanban className="h-8 w-8" />
              <p className="text-sm">Aún no hay proyectos. Crea el primero o convierte una captura del Inbox.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {projects.map((p) => {
                const pt = tasks.filter((t) => t.project_id === p.id);
                const done = pt.filter((t) => t.status === 'done').length;
                const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
                return (
                  <div
                    key={p.id}
                    onClick={() => router.push(`/projects/${p.id}`)}
                    className="group cursor-pointer rounded-lg border border-border bg-card p-4 hover:border-[hsl(var(--ring))]"
                  >
                    <div className="flex items-center gap-2">
                      <BadgeDot color={p.color} />
                      <h3 className="truncate text-[14px] font-semibold">{p.name}</h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 opacity-0 group-hover:opacity-100"
                        title="Archivar"
                        onClick={(e) => { e.stopPropagation(); archive(p.id); }}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {p.description && (
                      <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">{p.description}</p>
                    )}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{done}/{pt.length} tareas</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} />
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      Actualizado {format(new Date(p.updated_at), 'd MMM', { locale: es })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
