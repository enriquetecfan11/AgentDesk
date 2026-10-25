'use client';

import { Bot, Download, FilePlus2, Loader2, MoreHorizontal, Search, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { NoteEditor } from '@/components/notes/note-editor';
import { NoteImportDialog, type ImportSummary } from '@/components/notes/note-import-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { formatTimestamp } from '@/lib/dates';
import { noteExcerpt } from '@/lib/notes/markdown';
import { normalizeTitle } from '@/lib/notes/wikilinks';
import type { NoteDetailDTO, NoteListItemDTO, NoteRef, ProjectDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The notes section.
 *
 * Two panes on a wide screen, one at a time on a phone. The list and the open
 * note are kept in sync by hand: the editor writes, the list reflects, and the
 * server stays the source of truth for anything that touches other notes
 * (renames rebuild the link graph, so those answers must come back from the API).
 */
export function NotesWorkspace({
  initialNotes,
  projects,
}: {
  initialNotes: NoteListItemDTO[];
  projects: ProjectDTO[];
}) {
  const router = useRouter();

  const [notes, setNotes] = useState(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(initialNotes[0]?.id ?? null);
  const [detail, setDetail] = useState<NoteDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [authorFilter, setAuthorFilter] = useState<'all' | 'human' | 'agent'>('all');
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pane, setPane] = useState<'list' | 'editor'>('list');

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  // The detail of a note is always fetched fresh: backlinks depend on every
  // other note in the vault.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api
      .get<NoteDetailDTO>(`/api/notes/${selectedId}`)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setPane('editor');
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        toast.error(error instanceof Error ? error.message : 'No se pudo abrir la nota');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const needle = normalizeTitle(query);

    return notes.filter((note) => {
      if (authorFilter !== 'all' && note.authorType !== authorFilter) return false;
      if (needle.length === 0) return true;

      return (
        normalizeTitle(note.title).includes(needle) ||
        normalizeTitle(note.excerpt).includes(needle)
      );
    });
  }, [notes, query, authorFilter]);

  const noteIndex = useMemo(() => {
    const index = new Map<string, NoteRef>();
    for (const note of notes) {
      const key = normalizeTitle(note.title);
      if (key.length > 0 && !index.has(key)) index.set(key, { id: note.id, title: note.title });
    }
    return index;
  }, [notes]);

  const saveDraft = useCallback(
    async (patch: { title: string; contentMd: string }) => {
      if (!selectedId) return false;

      try {
        const next = await api.patch<NoteDetailDTO>(`/api/notes/${selectedId}`, patch);
        setDetail(next);
        setNotes((previous) =>
          previous.map((note) =>
            note.id === next.note.id
              ? {
                  ...note,
                  title: next.note.title,
                  excerpt: noteExcerpt(next.note.contentMd, next.note.title),
                  authorType: next.note.authorType,
                  authorId: next.note.authorId,
                  authorName: next.note.authorName,
                  projectId: next.note.projectId,
                  project: next.project,
                  updatedAt: next.note.updatedAt,
                  outgoingCount: next.outgoing.length,
                  backlinkCount: next.backlinks.length,
                }
              : note,
          ),
        );
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo guardar la nota');
        return false;
      }
    },
    [selectedId],
  );

  const createNote = useCallback(
    async (title?: string) => {
      const requested = (title ?? untitledName(notes)).trim();

      try {
        const created = await api.post<NoteDetailDTO>('/api/notes', {
          title: requested,
          contentMd: '',
        });

        setNotes((previous) => [toListItem(created), ...previous]);
        setSelectedId(created.note.id);
        setDetail(created);
        setPane('editor');
        router.refresh();
        return created;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo crear la nota');
        return null;
      }
    },
    [notes, router],
  );

  const deleteSelected = useCallback(async () => {
    if (!detail) return;

    const id = detail.note.id;
    const remaining = notes.filter((note) => note.id !== id);

    try {
      await api.del(`/api/notes/${id}`);
      toast.success('Nota eliminada');

      setNotes(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDetail(null);
      setPane('list');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la nota');
    }
  }, [detail, notes, router]);

  const changeProject = useCallback(
    async (projectId: string | null) => {
      if (!selectedId) return;

      try {
        const next = await api.patch<NoteDetailDTO>(`/api/notes/${selectedId}`, { projectId });
        setDetail(next);
        setNotes((previous) =>
          previous.map((note) =>
            note.id === next.note.id
              ? { ...note, projectId: next.note.projectId, project: next.project }
              : note,
          ),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el proyecto');
      }
    },
    [selectedId],
  );

  async function exportVault() {
    setExporting(true);
    try {
      const response = await fetch('/api/notes/export');
      if (!response.ok) throw new Error('No se pudo exportar');

      const count = response.headers.get('X-Note-Count') ?? '0';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `agentdesk-notas-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();

      URL.revokeObjectURL(url);
      toast.success(`${count} ${count === '1' ? 'nota exportada' : 'notas exportadas'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  }

  function handleImported(summary: ImportSummary) {
    const parts = [`${summary.created} nuevas`, `${summary.updated} actualizadas`];
    if (summary.skipped > 0) parts.push(`${summary.skipped} omitidas`);
    toast.success(`Importación terminada: ${parts.join(', ')}`);
    router.refresh();
  }

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          'flex w-full min-w-0 flex-col overflow-hidden border-r border-border sm:w-72 sm:shrink-0',
          pane === 'editor' && 'hidden sm:flex',
        )}
      >
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar notas…"
              aria-label="Buscar notas"
              className="h-9 pl-7 text-xs"
            />
          </div>

          <Button
            size="icon"
            className="size-9 shrink-0"
            onClick={() => void createNote()}
            aria-label="Nueva nota"
            title="Nueva nota"
          >
            <FilePlus2 className="size-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground"
                aria-label="Más acciones del vault"
                title="Más acciones"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Upload className="mr-2 size-4" />
                Importar vault
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={exporting}
                onSelect={() => void exportVault()}
              >
                {exporting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Download className="mr-2 size-4" />
                )}
                Exportar vault
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <div
            className="grid min-w-0 flex-1 grid-cols-3 gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5"
            role="group"
            aria-label="Filtrar notas por autor"
          >
            {(
              [
                { value: 'all', label: 'Todas' },
                { value: 'human', label: 'Mías' },
                { value: 'agent', label: 'Agentes' },
              ] as const
            ).map((option) => (
              <Button
                key={option.value}
                variant={authorFilter === option.value ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 w-full px-1 text-[11px]',
                  authorFilter === option.value && 'shadow-sm',
                )}
                aria-pressed={authorFilter === option.value}
                onClick={() => setAuthorFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {filtered.length}
            {filtered.length !== notes.length && `/${notes.length}`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {notes.length === 0 ? 'Todavía no hay notas.' : 'Ninguna nota coincide.'}
            </p>
          ) : (
            <ul>
              {filtered.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    aria-current={note.id === selectedId}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left',
                      'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      note.id === selectedId &&
                        'bg-muted/60 shadow-[inset_2px_0_0_hsl(var(--primary))]',
                    )}
                  >
                    <span className="truncate text-sm font-medium">{note.title}</span>
                    {note.excerpt && (
                      <span className="truncate text-xs text-muted-foreground">{note.excerpt}</span>
                    )}
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{formatTimestamp(note.updatedAt)}</span>
                      {note.authorType === 'agent' && (
                        <span className="inline-flex min-w-0 items-center gap-0.5 text-primary/80">
                          <Bot className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{note.authorName}</span>
                        </span>
                      )}
                      {note.backlinkCount > 0 && <span>{note.backlinkCount} enlaces</span>}
                      {note.project && <span className="truncate">{note.project.name}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section
        className={cn('min-w-0 flex-1', pane === 'list' && 'hidden sm:block')}
        aria-label="Nota"
      >
        {loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : detail ? (
          <NoteEditor
            key={detail.note.id}
            detail={detail}
            projects={projects}
            noteIndex={noteIndex}
            onSaveDraft={saveDraft}
            onDelete={() => void deleteSelected()}
            onOpenNote={setSelectedId}
            onCreateNote={(title) => void createNote(title)}
            onProjectChange={(projectId) => void changeProject(projectId)}
            onBack={() => setPane('list')}
          />
        ) : (
          <EmptyPane
            hasNotes={notes.length > 0}
            onCreate={() => void createNote()}
            onCreateTemplate={(title) => void createNote(title)}
            onImport={() => setImportOpen(true)}
          />
        )}
      </section>

      <NoteImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={handleImported} />
    </div>
  );
}

function EmptyPane({
  hasNotes,
  onCreate,
  onCreateTemplate,
  onImport,
}: {
  hasNotes: boolean;
  onCreate: () => void;
  onCreateTemplate: (title: string) => void;
  onImport: () => void;
}) {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center">
      <div className="max-w-sm space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          {hasNotes ? 'Elige una nota' : 'Notas'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {hasNotes
            ? 'Selecciona una nota de la lista para leerla o editarla.'
            : 'Markdown con enlaces [[entre notas]] y backlinks. Puedes importar y exportar un vault de Obsidian tal cual.'}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" onClick={onCreate}>
            <FilePlus2 className="mr-1.5 size-4" />
            Nueva nota
          </Button>
          <Button size="sm" variant="outline" onClick={onImport}>
            <Upload className="mr-1.5 size-4" />
            Importar
          </Button>
        </div>
        {!hasNotes && (
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            {['Nota de proyecto', 'Decisión', 'Brief para agente'].map((template) => (
              <Button
                key={template}
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => onCreateTemplate(template)}
              >
                {template}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function toListItem(detail: NoteDetailDTO): NoteListItemDTO {
  return {
    id: detail.note.id,
    title: detail.note.title,
    excerpt: noteExcerpt(detail.note.contentMd, detail.note.title),
    authorType: detail.note.authorType,
    authorId: detail.note.authorId,
    authorName: detail.note.authorName,
    projectId: detail.note.projectId,
    project: detail.project,
    updatedAt: detail.note.updatedAt,
    createdAt: detail.note.createdAt,
    outgoingCount: detail.outgoing.length,
    backlinkCount: detail.backlinks.length,
  };
}

/** \"Nueva nota\", then \"Nueva nota 2\", \"Nueva nota 3\"… */
function untitledName(notes: NoteListItemDTO[]): string {
  const taken = new Set(notes.map((note) => normalizeTitle(note.title)));
  if (!taken.has(normalizeTitle('Nueva nota'))) return 'Nueva nota';

  for (let index = 2; index < 500; index += 1) {
    const candidate = `Nueva nota ${index}`;
    if (!taken.has(normalizeTitle(candidate))) return candidate;
  }

  return `Nueva nota ${Date.now()}`;
}
