/**
 * YAML frontmatter, as Obsidian writes it.
 *
 * Only the subset a vault actually uses is understood: scalars, inline lists
 * (`tags: [a, b]`) and block lists. Unknown keys are preserved on import so a
 * round-trip through AgentDesk does not silently drop metadata.
 */
import { noteFileName, titleFromFileName } from '@/lib/notes/wikilinks';

export type FrontmatterValue = string | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

const DELIMITER = /^---\s*$/;

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim();

  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter((item) => item.length > 0);
  }

  return unquote(value);
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseFrontmatter(source: string): { data: Frontmatter; body: string } {
  const text = source.replace(/\r\n?/g, '\n');
  if (!text.startsWith('---')) return { data: {}, body: text };

  const lines = text.split('\n');
  if (!DELIMITER.test(lines[0] ?? '')) return { data: {}, body: text };

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (DELIMITER.test(lines[index])) {
      end = index;
      break;
    }
  }

  if (end < 0) return { data: {}, body: text };

  const data: Frontmatter = {};
  let pendingKey: string | null = null;

  for (const line of lines.slice(1, end)) {
    const blockItem = line.match(/^\s*-\s+(.*)$/);
    if (blockItem && pendingKey) {
      const current = data[pendingKey];
      const list = Array.isArray(current) ? current : current ? [current] : [];
      list.push(unquote(blockItem[1].trim()));
      data[pendingKey] = list;
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!pair) {
      pendingKey = null;
      continue;
    }

    pendingKey = pair[1];
    data[pendingKey] = pair[2].trim().length === 0 ? [] : parseScalar(pair[2]);
  }

  return { data, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

export function stringifyFrontmatter(data: Frontmatter, body: string): string {
  const entries = Object.entries(data).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : value.length > 0,
  );

  if (entries.length === 0) return `${body.replace(/^\n+/, '')}`;

  const lines = entries.map(([key, value]) =>
    Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value}`,
  );

  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

function asString(value: FrontmatterValue | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function asList(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : value.length > 0 ? [value] : [];
}

export type NoteFile = {
  title: string;
  contentMd: string;
  tags: string[];
};

/** A note as a standalone Obsidian file, frontmatter included. */
export function noteToMarkdownFile(note: {
  title: string;
  contentMd: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}): { fileName: string; contents: string } {
  const data: Frontmatter = {
    title: note.title,
    tags: note.tags ?? [],
  };

  if (note.createdAt) data.created = note.createdAt;
  if (note.updatedAt) data.updated = note.updatedAt;

  return {
    fileName: noteFileName(note.title),
    contents: stringifyFrontmatter(data, note.contentMd),
  };
}

/**
 * A markdown file (or a vault file) as a note.
 *
 * Title precedence: frontmatter, then the file name, then the first `#` heading.
 */
export function markdownFileToNote(
  fileName: string,
  contents: string,
): NoteFile & { frontmatter: Frontmatter } {
  const { data, body } = parseFrontmatter(contents);

  const heading = body.match(/^#{1,6}\s+(.+)$/m);
  const title =
    asString(data.title) ??
    (titleFromFileName(fileName) || heading?.[1]?.trim() || 'Sin título');

  return {
    title,
    contentMd: body.trim(),
    tags: asList(data.tags),
    frontmatter: data,
  };
}
