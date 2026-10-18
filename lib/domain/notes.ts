import 'server-only';

import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { noteLinks, notes, projects } from '@/lib/db/schema';
import { serializeNote } from '@/lib/domain/serialize';
import { markdownFileToNote, noteToMarkdownFile } from '@/lib/notes/frontmatter';
import { markdownToPlainText } from '@/lib/notes/markdown';
import { extractWikiLinks, normalizeTitle } from '@/lib/notes/wikilinks';
import type { NoteDetailDTO, NoteListItemDTO, NoteRef } from '@/lib/types';
import type { NoteCreateInput, NoteImportInput, NoteUpdateInput } from '@/lib/validation';

/**
 * Thrown when a title is already taken.
 *
 * The title is the identity of a note — it is what `[[wiki links]]` point at —
 * so the database keeps a unique index on it. The domain reports the clash with
 * its own error instead of an HTTP status to stay free of transport concerns;
 * the route turns it into a 409.
 */
export class DuplicateNoteTitleError extends Error {
  constructor(readonly title: string) {
    super(`Ya existe una nota titulada «${title}»`);
    this.name = 'DuplicateNoteTitleError';
  }
}

type TitleEntry = { id: string; title: string };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * Every note title, keyed by its normalised form (case- and accent-insensitive).
 *
 * Resolution is done in memory rather than in SQL because it has to use exactly
 * the same normalisation as the link parser. A mismatch between the two would
 * produce backlinks that silently disappear.
 */
async function titleIndex(): Promise<Map<string, TitleEntry>> {
  const rows = await db.select({ id: notes.id, title: notes.title }).from(notes);

  const index = new Map<string, TitleEntry>();
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (key.length > 0 && !index.has(key)) index.set(key, row);
  }

  return index;
}

function toRef(row: { id: string; title: string }): NoteRef {
  return { id: row.id, title: row.title };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type NoteFilters = {
  search?: string;
  projectId?: string;
  limit?: number;
};

export async function listNotes(filters: NoteFilters = {}): Promise<NoteListItemDTO[]> {
  const rows = await db
    .select({ note: notes, project: projects })
    .from(notes)
    .leftJoin(projects, eq(notes.projectId, projects.id))
    .where(filters.projectId ? eq(notes.projectId, filters.projectId) : undefined)
    .orderBy(desc(notes.updatedAt))
    .limit(filters.limit ?? 500);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.note.id);

  const [outgoing, incoming] = await Promise.all([
    db
      .select({ from: noteLinks.fromNoteId })
      .from(noteLinks)
      .where(inArray(noteLinks.fromNoteId, ids)),
    db
      .select({ to: noteLinks.toNoteId })
      .from(noteLinks)
      .where(inArray(noteLinks.toNoteId, ids)),
  ]);

  const outgoingCount = new Map<string, number>();
  for (const row of outgoing) {
    outgoingCount.set(row.from, (outgoingCount.get(row.from) ?? 0) + 1);
  }

  const backlinkCount = new Map<string, number>();
  for (const row of incoming) {
    backlinkCount.set(row.to, (backlinkCount.get(row.to) ?? 0) + 1);
  }

  const needle = filters.search ? normalizeTitle(filters.search) : null;

  const items: NoteListItemDTO[] = rows.map(({ note, project }) => {
    const base = serializeNote(note);

    return {
      id: note.id,
      title: note.title,
      excerpt: markdownToPlainText(note.contentMd, 140),
      projectId: note.projectId,
      project: project
        ? {
            id: project.id,
            name: project.name,
            identifier: project.identifier,
            color: project.color,
          }
        : null,
      updatedAt: base.updatedAt,
      createdAt: base.createdAt,
      outgoingCount: outgoingCount.get(note.id) ?? 0,
      backlinkCount: backlinkCount.get(note.id) ?? 0,
    };
  });

  if (!needle) return items;

  return items.filter(
    (item) =>
      normalizeTitle(item.title).includes(needle) ||
      normalizeTitle(item.excerpt).includes(needle),
  );
}

export async function getNote(id: string): Promise<NoteDetailDTO | null> {
  const [row] = await db
    .select({ note: notes, project: projects })
    .from(notes)
    .leftJoin(projects, eq(notes.projectId, projects.id))
    .where(eq(notes.id, id))
    .limit(1);

  if (!row) return null;

  const index = await titleIndex();

  // Outgoing links are resolved from the content on every read, so they stay
  // correct even when the target was renamed or deleted in the meantime.
  const outgoing = extractWikiLinks(row.note.contentMd).map((target) => {
    const found = index.get(normalizeTitle(target));
    return { title: target, note: found ? toRef(found) : null };
  });

  const [backlinkRows, relatedRows] = await Promise.all([
    db
      .select({ id: notes.id, title: notes.title })
      .from(noteLinks)
      .innerJoin(notes, eq(notes.id, noteLinks.fromNoteId))
      .where(eq(noteLinks.toNoteId, id))
      .orderBy(asc(notes.title)),
    row.note.projectId
      ? db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(and(eq(notes.projectId, row.note.projectId), ne(notes.id, id)))
          .orderBy(asc(notes.title))
          .limit(20)
      : Promise.resolve([] as NoteRef[]),
  ]);

  return {
    note: serializeNote(row.note),
    project: row.project
      ? {
          id: row.project.id,
          name: row.project.name,
          identifier: row.project.identifier,
          color: row.project.color,
        }
      : null,
    backlinks: backlinkRows.map(toRef),
    outgoing,
    related: relatedRows.map(toRef),
  };
}

/** Resolution of one `[[title]]`, used when a link does not point anywhere yet. */
export async function findNoteByTitle(title: string): Promise<NoteRef | null> {
  const index = await titleIndex();
  const found = index.get(normalizeTitle(title));
  return found ? toRef(found) : null;
}

// ---------------------------------------------------------------------------
// Link maintenance
// ---------------------------------------------------------------------------

/** Recomputes the `note_links` rows that start at one note. */
export async function rebuildLinks(noteId: string): Promise<void> {
  const [row] = await db
    .select({ contentMd: notes.contentMd })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);

  if (!row) return;

  const index = await titleIndex();
  const targets = new Set<string>();

  for (const target of extractWikiLinks(row.contentMd)) {
    const found = index.get(normalizeTitle(target));
    // A note linking to itself is shown as an unrelated link, not a backlink.
    if (found && found.id !== noteId) targets.add(found.id);
  }

  await db.transaction(async (tx) => {
    await tx.delete(noteLinks).where(eq(noteLinks.fromNoteId, noteId));

    if (targets.size > 0) {
      await tx
        .insert(noteLinks)
        .values([...targets].map((toNoteId) => ({ fromNoteId: noteId, toNoteId })))
        .onConflictDoNothing();
    }
  });
}

/**
 * Recomputes every link in the vault.
 *
 * Needed after a rename: a note that used to point at the old title must now
 * point at the new one, and any note that already used the new title starts
 * pointing somewhere else.
 */
export async function rebuildAllLinks(): Promise<number> {
  const rows = await db
    .select({ id: notes.id, title: notes.title, contentMd: notes.contentMd })
    .from(notes);

  const index = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (key.length > 0) index.set(key, row.id);
  }

  const pairs: { fromNoteId: string; toNoteId: string }[] = [];

  for (const row of rows) {
    const resolved = new Set<string>();

    for (const target of extractWikiLinks(row.contentMd)) {
      const toNoteId = index.get(normalizeTitle(target));
      if (toNoteId && toNoteId !== row.id) resolved.add(toNoteId);
    }

    for (const toNoteId of resolved) pairs.push({ fromNoteId: row.id, toNoteId });
  }

  await db.transaction(async (tx) => {
    await tx.delete(noteLinks);
    if (pairs.length > 0) {
      await tx.insert(noteLinks).values(pairs).onConflictDoNothing();
    }
  });

  return pairs.length;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createNote(input: NoteCreateInput): Promise<NoteDetailDTO> {
  const index = await titleIndex();
  if (index.has(normalizeTitle(input.title))) throw new DuplicateNoteTitleError(input.title);

  let id: string;

  try {
    const [row] = await db
      .insert(notes)
      .values({
        title: input.title,
        contentMd: input.contentMd ?? '',
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        source: 'app',
      })
      .returning();

    id = row.id;
  } catch (error) {
    // The pre-check above can lose a race; the index is the real guarantee.
    if (isUniqueViolation(error)) throw new DuplicateNoteTitleError(input.title);
    throw error;
  }

  // Every link in the vault is recomputed, not just the new note's: a title
  // that did not exist until now may well be what some other note was already
  // pointing at with a dangling `[[link]]`.
  await rebuildAllLinks();

  return (await getNote(id))!;
}

export async function updateNote(
  id: string,
  input: NoteUpdateInput,
): Promise<NoteDetailDTO | null> {
  const [current] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  if (!current) return null;

  const patch: Partial<typeof notes.$inferInsert> = { updatedAt: new Date() };
  let renamed = false;

  if (input.title !== undefined && input.title !== current.title) {
    const index = await titleIndex();
    const clash = index.get(normalizeTitle(input.title));
    if (clash && clash.id !== id) throw new DuplicateNoteTitleError(input.title);

    patch.title = input.title;
    renamed = true;
  }

  if (input.contentMd !== undefined) patch.contentMd = input.contentMd;
  if (input.projectId !== undefined) patch.projectId = input.projectId ?? null;
  if (input.taskId !== undefined) patch.taskId = input.taskId ?? null;

  try {
    const [row] = await db.update(notes).set(patch).where(eq(notes.id, id)).returning();
    if (!row) return null;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateNoteTitleError(input.title ?? current.title);
    throw error;
  }

  if (renamed) {
    await rebuildAllLinks();
  } else if (input.contentMd !== undefined) {
    await rebuildLinks(id);
  }

  return getNote(id);
}

export async function deleteNote(id: string): Promise<boolean> {
  const [row] = await db.delete(notes).where(eq(notes.id, id)).returning({ id: notes.id });
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export type ImportSummary = {
  created: number;
  updated: number;
  /** Files ignored because the title was already taken and `overwrite` was off. */
  skipped: number;
  titles: string[];
};

/**
 * Imports a vault.
 *
 * Titles are the identity, so a file whose title already exists is skipped
 * unless the caller asked to overwrite. Nothing is ever deleted: importing a
 * folder can only add.
 */
export async function importNotes(input: NoteImportInput): Promise<ImportSummary> {
  const index = await titleIndex();
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, titles: [] };

  for (const file of input.files) {
    const parsed = markdownFileToNote(file.name, file.content);
    const key = normalizeTitle(parsed.title);

    if (key.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const existing = index.get(key);

    if (existing) {
      if (!input.overwrite) {
        summary.skipped += 1;
        continue;
      }

      await db
        .update(notes)
        .set({ contentMd: parsed.contentMd, updatedAt: new Date() })
        .where(eq(notes.id, existing.id));

      summary.updated += 1;
      summary.titles.push(parsed.title);
      continue;
    }

    try {
      const [row] = await db
        .insert(notes)
        .values({
          title: parsed.title,
          contentMd: parsed.contentMd,
          source: 'obsidian',
        })
        .returning();

      index.set(key, { id: row.id, title: row.title });
      summary.created += 1;
      summary.titles.push(parsed.title);
    } catch (error) {
      if (isUniqueViolation(error)) {
        summary.skipped += 1;
        continue;
      }
      throw error;
    }
  }

  await rebuildAllLinks();

  return summary;
}

export type ExportedNote = { fileName: string; contents: string };

/** Every note as a standalone Markdown file, ready to drop into a vault. */
export async function exportNotes(): Promise<ExportedNote[]> {
  const rows = await db.select().from(notes).orderBy(asc(notes.title));
  const used = new Set<string>();
  const files: ExportedNote[] = [];

  for (const note of rows) {
    const base = serializeNote(note);
    const file = noteToMarkdownFile({
      title: note.title,
      contentMd: note.contentMd,
      createdAt: base.createdAt.slice(0, 10),
      updatedAt: base.updatedAt.slice(0, 10),
    });

    // Sanitising can make two different titles collide ("a/b" and "a:b");
    // a ZIP with repeated names would silently lose one of them.
    let fileName = file.fileName;
    let suffix = 2;
    while (used.has(fileName.toLowerCase())) {
      fileName = file.fileName.replace(/\.md$/, ` (${suffix}).md`);
      suffix += 1;
    }

    used.add(fileName.toLowerCase());
    files.push({ fileName, contents: file.contents });
  }

  return files;
}
