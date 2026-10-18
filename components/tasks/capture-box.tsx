'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTask, listAgents, listProjects } from '@/lib/api';
import type { AgentWithActor, Project, TaskStatus, TaskPriority } from '@/lib/types';
import { parseCapture } from '@/lib/capture';
import { cn } from '@/lib/utils';
import { Loader2, Plus, X } from 'lucide-react';

const STATUS_VALUES: TaskStatus[] = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITY_VALUES: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

export function CaptureBox({
  projectId, taskId, status, placeholder, autoFocus,
}: {
  projectId?: string | null; taskId?: string | null; status?: TaskStatus;
  placeholder?: string; autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof parseCapture> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (value.trim()) {
      const t = setTimeout(() => setPreview(parseCapture(value)), 30);
      return () => clearTimeout(t);
    }
    setPreview(null);
  }, [value]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = async () => {
    const raw = value.trim();
    if (!raw || busy) return;
    setBusy(true);
    try {
      const parsed = parseCapture(raw);
      let pid = projectId ?? null;
      if (!pid && parsed.projectName) {
        const match = projects.find((p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase());
        pid = match?.id ?? null;
      }
      await createTask({
        title: parsed.title,
        priority: parsed.priority ?? 'normal',
        due_date: parsed.dueDate,
        project_id: pid,
        parent_task_id: taskId ?? null,
        status: status ?? 'backlog',
      });
      setValue('');
      setPreview(null);
      router.refresh();
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm',
          'focus-within:border-[hsl(var(--ring))]',
        )}
      >
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setValue('');
          }}
          placeholder={placeholder ?? 'Añadir tarea (usa #proyecto, !prioridad, mañana, 24/10…)'}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {value && (
          <button onClick={() => setValue('')} className="text-muted-foreground hover:text-foreground" aria-label="Limpiar">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {preview && (preview.projectName || preview.dueDate || (preview.priority && preview.priority !== 'normal')) && (
        <div className="flex flex-wrap items-center gap-2 px-3 text-[11px] text-muted-foreground">
          {preview.projectName && (
            <span>
              {projects.some((p) => p.name.toLowerCase() === preview.projectName!.toLowerCase())
                ? `Proyecto: ${preview.projectName}`
                : `# ${preview.projectName} (sin proyecto coincidente)`}
            </span>
          )}
          {preview.dueDate && <span>Fecha: {preview.dueDate}</span>}
          {preview.priority && preview.priority !== 'normal' && <span>Prioridad: {preview.priority}</span>}
          {preview.title && <span className="truncate text-foreground/70">{preview.title}</span>}
        </div>
      )}
    </div>
  );
}
