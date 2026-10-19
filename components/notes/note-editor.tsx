'use client';

import {
  ArrowLeft,
  Check,
  Eye,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { MarkdownView } from '@/components/notes/markdown-view';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { NoteDetailDTO, NoteRef, ProjectDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const AUTOSAVE_DELAY = 900;
const NO_PROJECT = '__none__';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * One note: title, body, and the links in and out of it.
 *
 * The draft is saved on its own, shortly after typing stops and when a field
 * loses the focus, so there is no save button to forget. The parent remounts
 * this component whenever another note is selected (`key`), which is why the
 * draft can live in plain state.
 */
export function NoteEditor({
  detail,
  projects,
  noteIndex,
  onSaveDraft,
  onDelete,
  onOpenNote,
  onCreateNote,
  onProjectChange,
  onBack,
}: {
  detail: NoteDetailDTO;
  projects: ProjectDTO[];
  noteIndex: Map<string, NoteRef>;
  onSaveDraft: (patch: { title: string; contentMd: string }) => Promise<boolean>;
  onDelete: () => void;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>(detail.note.contentMd ? 'preview' : 'edit');
  const [title, setTitle] = useState(detail.note.title);
  const [contentMd, setContentMd] = useState(detail.note.contentMd);
  const [state, setState] = useState<SaveState>('idle');

  const dirty = title.trim() !== detail.note.title || contentMd !== detail.note.contentMd;

  async function save() {
    // The server trims the title; sending the trimmed value back into the
    // draft is what stops the autosave from firing again for the same edit.
    const payload = { title: title.trim() || 'Sin título', contentMd };

    setState('saving');
    const ok = await onSaveDraft(payload);

    if (ok) {
      setTitle(payload.title);
      setState('saved');
    } else {
      setState('error');
    }
  }

  useEffect(() => {
    if (!dirty) return;

    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
    // `save` closes over the current draft, so the draft is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, contentMd, dirty]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 sm:hidden"
          onClick={onBack}
          aria-label="Volver a la lista"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SaveIndicator state={state} dirty={dirty} />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={mode === 'edit' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setMode('edit')}
            aria-pressed={mode === 'edit'}
          >
            <Pencil className="size-3.5" />
            Editar
          </Button>
          <Button
            variant={mode === 'preview' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setMode('preview')}
            aria-pressed={mode === 'preview'}
          >
            <Eye className="size-3.5" />
            Vista previa
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Eliminar la nota ${detail.note.title}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar «{detail.note.title}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borrará el contenido de la nota. Los enlaces que apunten a ella quedarán sin
                  destino, pero no se toca ninguna otra nota.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Eliminar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (dirty) void save();
          }}
          aria-label="Título de la nota"
          placeholder="Título de la nota"
          className="h-9 min-w-0 border-0 px-1 text-base font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
        />

        <Select
          value={detail.note.projectId ?? NO_PROJECT}
          onValueChange={(next) => onProjectChange(next === NO_PROJECT ? null : next)}
        >
          <SelectTrigger className="h-8 w-auto shrink-0 gap-1.5 border-0 text-xs text-muted-foreground shadow-none">
            <SelectValue placeholder="Sin proyecto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROJECT} className="text-xs">
              Sin proyecto
            </SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id} className="text-xs">
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === 'edit' ? (
          <Textarea
            value={contentMd}
            onChange={(event) => setContentMd(event.target.value)}
            onBlur={() => {
              if (dirty) void save();
            }}
            spellCheck
            placeholder={'# Título\n\nEscribe en Markdown. Usa [[Otra nota]] para enlazar.'}
            className="min-h-full resize-none rounded-none border-0 px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        ) : (
          <div className="px-4 py-3">
            <MarkdownView
              source={contentMd}
              noteIndex={noteIndex}
              onOpenNote={onOpenNote}
              onCreateNote={onCreateNote}
            />
          </div>
        )}
      </div>

      <LinkPanel detail={detail} onOpenNote={onOpenNote} onCreateNote={onCreateNote} />
    </div>
  );
}

function SaveIndicator({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" />
        Guardando…
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <TriangleAlert className="size-3.5" />
        No se pudo guardar
      </span>
    );
  }

  if (dirty) {
    return <span className="text-muted-foreground/70">Sin guardar…</span>;
  }

  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Check className="size-3.5" />
        Guardado
      </span>
    );
  }

  return null;
}

function LinkPanel({
  detail,
  onOpenNote,
  onCreateNote,
}: {
  detail: NoteDetailDTO;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
}) {
  const hasAnything =
    detail.outgoing.length > 0 || detail.backlinks.length > 0 || detail.related.length > 0;

  if (!hasAnything) return null;

  return (
    <footer className="max-h-56 shrink-0 overflow-y-auto border-t border-border px-3 py-2.5">
      <div className="grid gap-3 sm:grid-cols-2">
        {detail.outgoing.length > 0 && (
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Link2 className="size-3" />
              Enlaza con
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {detail.outgoing.map((link) => (
                <li key={link.title}>
                  {link.note ? (
                    <button
                      type="button"
                      onClick={() => onOpenNote(link.note!.id)}
                      className="rounded-full border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {link.title}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCreateNote(link.title)}
                      title="Crear esta nota"
                      className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {link.title} +
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail.backlinks.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Mencionada en
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {detail.backlinks.map((link) => (
                <li key={link.id}>
                  <button
                    type="button"
                    onClick={() => onOpenNote(link.id)}
                    className="rounded-full border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail.related.length > 0 && (
          <section className="sm:col-span-2">
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              En el mismo proyecto
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {detail.related.map((link) => (
                <li key={link.id}>
                  <button
                    type="button"
                    onClick={() => onOpenNote(link.id)}
                    className={cn(
                      'rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground',
                      'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    {link.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </footer>
  );
}
