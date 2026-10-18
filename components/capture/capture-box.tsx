'use client';

import { CornerDownLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { hasCaptureDetail, parseCapture } from '@/lib/capture';
import type { TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

type CaptureResponse = {
  task: TaskDTO;
  notes: string[];
};

/**
 * The one input everything goes through.
 *
 * The parsing preview is the point: it shows what the line was understood to
 * mean *before* the task is created, so nobody has to guess what `p1` or
 * `@casa` did.
 */
export function CaptureBox({
  projectId = null,
  autoFocus = false,
  placeholder = 'Escribe algo… «revisar CVEs mañana 10:00 p1 #wazuh»',
  className,
  onCreated,
}: {
  projectId?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  onCreated?: (task: TaskDTO) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputId = useId();

  const capture = parseCapture(value);
  const showsPreview = value.trim().length > 0 && hasCaptureDetail(capture);

  async function submit() {
    const text = value.trim();
    if (!text || saving) return;

    setSaving(true);
    try {
      const result = await api.post<CaptureResponse>('/api/capture', { text, projectId });

      for (const note of result.notes) toast.warning(note);
      toast.success(`Capturado: ${result.task.title}`);

      setValue('');
      onCreated?.(result.task);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo capturar la tarea');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      <label htmlFor={inputId} className="sr-only">
        Captura rápida
      </label>

      <Textarea
        id={inputId}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter captures, Shift+Enter adds a line.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="min-h-11 resize-none border-0 bg-transparent py-3 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
      />

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-3 py-1.5">
        {showsPreview ? (
          <>
            <span className="text-[11px] text-muted-foreground">Se entiende:</span>
            {capture.hints.map((hint) => (
              <span
                key={hint}
                className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
              >
                {hint}
              </span>
            ))}
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Fechas, horas, <code className="font-mono">p1</code>–<code className="font-mono">p4</code>,{' '}
            <code className="font-mono">#proyecto</code>, <code className="font-mono">@etiqueta</code> y
            recurrencias.
          </span>
        )}

        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CornerDownLeft className="size-3.5" />
          )}
          Intro para guardar
        </span>
      </div>
    </div>
  );
}
