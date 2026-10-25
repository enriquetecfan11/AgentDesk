/**
 * A small, safe Markdown parser.
 *
 * It produces a tree of plain JSON nodes instead of an HTML string, so the
 * renderer builds React elements directly and there is no `dangerouslySetInnerHTML`
 * anywhere in the application. Nothing a note contains can inject markup.
 *
 * The supported subset is what a personal notebook actually uses: headings,
 * paragraphs, emphasis, inline code, fenced code, lists (including task lists),
 * quotes, rules, links, images, `[[wiki links]]` and hard line breaks.
 */

import { normalizeTitle } from './wikilinks';

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'del'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'wikilink'; target: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'br' };

export type ListItem = { checked: boolean | null; children: InlineNode[] };

export type BlockNode =
  | { type: 'heading'; level: number; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'quote'; children: InlineNode[] }
  | { type: 'hr' };

const MAX_DEPTH = 12;

/** Characters that can be escaped with a backslash. */
const ESCAPABLE = /[`*_~[\]!\\]/;

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6})\s+/.test(line) ||
    /^\s*(```|~~~)/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
  );
}

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Fenced code — everything inside is literal.
    const fence = line.match(/^\s*(```|~~~)\s*(\S*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }

      index += 1; // closing fence
      blocks.push({ type: 'code', lang: fence[2] || null, value: body.join('\n') });
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        body.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(body.join('\n')) });
      continue;
    }

    const listStart = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (listStart) {
      const ordered = !/^[-*+]$/.test(listStart[2]);
      const items: ListItem[] = [];

      while (index < lines.length) {
        const item = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!item) break;
        if (!/^[-*+]$/.test(item[2]) !== ordered) break;

        let content = item[3];
        let checked: boolean | null = null;
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          checked = task[1].toLowerCase() === 'x';
          content = task[2];
        }

        items.push({ checked, children: parseInline(content) });
        index += 1;
      }

      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: consecutive lines that do not open another block.
    const paragraph: string[] = [line.trim()];
    index += 1;

    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }

  return blocks;
}

/** Matches `[text](href)` starting at `start`, which must point at the `[`. */
function matchLink(
  source: string,
  start: number,
  depth: number,
): { href: string; children: InlineNode[]; end: number } | null {
  const close = source.indexOf(']', start + 1);
  if (close < 0 || source[close + 1] !== '(') return null;

  const hrefEnd = source.indexOf(')', close + 2);
  if (hrefEnd < 0) return null;

  return {
    href: source.slice(close + 2, hrefEnd).trim(),
    children: parseInline(source.slice(start + 1, close), depth + 1),
    end: hrefEnd + 1,
  };
}

function matchEmphasis(
  source: string,
  start: number,
  depth: number,
): { node: InlineNode; end: number } | null {
  const patterns: { marker: string; type: 'strong' | 'em' | 'del' }[] = [
    { marker: '**', type: 'strong' },
    { marker: '__', type: 'strong' },
    { marker: '~~', type: 'del' },
    { marker: '*', type: 'em' },
    { marker: '_', type: 'em' },
  ];

  for (const { marker, type } of patterns) {
    if (!source.startsWith(marker, start)) continue;

    const contentStart = start + marker.length;
    const first = source[contentStart];
    // "** texto **" and "2 * 3" are not emphasis.
    if (first === undefined || /\s/.test(first)) continue;

    const close = source.indexOf(marker, contentStart);
    if (close < 0) continue;

    // A closing run longer than the marker ("***") belongs partly to an inner
    // emphasis, so the outer marker takes the tail of the run.
    const char = marker[0];
    let runEnd = close;
    while (source[runEnd] === char) runEnd += 1;

    const closeAt = runEnd - close > marker.length ? runEnd - marker.length : close;

    const content = source.slice(contentStart, closeAt);
    if (content.length === 0 || /\s$/.test(content)) continue;

    // `snake_case` is not emphasis.
    if (marker.startsWith('_') && /[\p{L}\p{N}]/u.test(source[start - 1] ?? '')) continue;

    return {
      node: { type, children: parseInline(content, depth + 1) },
      end: closeAt + marker.length,
    };
  }

  return null;
}

export function parseInline(source: string, depth = 0): InlineNode[] {
  if (depth > MAX_DEPTH) return [{ type: 'text', value: source }];

  const nodes: InlineNode[] = [];
  let buffer = '';
  let index = 0;

  function flush() {
    if (buffer.length > 0) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  }

  while (index < source.length) {
    const char = source[index];

    if (char === '\\' && index + 1 < source.length && ESCAPABLE.test(source[index + 1])) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    if (char === '`') {
      const close = source.indexOf('`', index + 1);
      if (close > index) {
        flush();
        nodes.push({ type: 'code', value: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    if (char === '!' && source[index + 1] === '[') {
      const image = matchLink(source, index + 1, depth);
      if (image) {
        flush();
        nodes.push({ type: 'image', src: image.href, alt: plainText(image.children) });
        index = image.end;
        continue;
      }
    }

    if (char === '[' && source[index + 1] === '[') {
      const close = source.indexOf(']]', index + 2);
      if (close > index) {
        flush();
        // `[[Nota|texto visible]]` and `[[Nota#Sección]]` are both accepted.
        const target = source.slice(index + 2, close).split('|')[0].split('#')[0].trim();
        nodes.push({ type: 'wikilink', target });
        index = close + 2;
        continue;
      }
    }

    if (char === '[') {
      const link = matchLink(source, index, depth);
      if (link) {
        flush();
        nodes.push({ type: 'link', href: link.href, children: link.children });
        index = link.end;
        continue;
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const emphasis = matchEmphasis(source, index, depth);
      if (emphasis) {
        flush();
        nodes.push(emphasis.node);
        index = emphasis.end;
        continue;
      }
    }

    if (char === '\n') {
      flush();
      nodes.push({ type: 'br' });
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export function plainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        case 'wikilink':
          return node.target;
        case 'image':
          return node.alt;
        case 'br':
          return ' ';
        default:
          return plainText(node.children);
      }
    })
    .join('');
}

/** Flattens blocks to one line of text, then applies the optional limit. */
function blocksToPlainText(blocks: BlockNode[], limit = 0): string {
  const text = blocks
    .map((block) => {
      switch (block.type) {
        case 'code':
          return block.value;
        case 'list':
          return block.items.map((item) => plainText(item.children)).join(' • ');
        case 'hr':
          return '';
        default:
          return plainText(block.children);
      }
    })
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  return limit > 0 && text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

/** Flattens a note to text: used for list excerpts and for search. */
export function markdownToPlainText(source: string, limit = 0): string {
  return blocksToPlainText(parseMarkdown(source), limit);
}

/** Whether the first block is an H1 that just repeats the note title. */
function repeatsTitle(blocks: BlockNode[], title: string): boolean {
  const first = blocks[0];
  if (!first || first.type !== 'heading' || first.level !== 1) return false;

  const wanted = normalizeTitle(title);
  return wanted.length > 0 && normalizeTitle(plainText(first.children)) === wanted;
}

/**
 * Drops a leading `# Título` when the note's title field already says the same
 * thing. Markdown exports from Obsidian start with the title as a heading, and
 * showing it twice — once as the title, once as the first line — reads as a
 * bug.
 */
export function stripDuplicateTitleHeading(blocks: BlockNode[], title?: string): BlockNode[] {
  if (!title || !repeatsTitle(blocks, title)) return blocks;
  return blocks.slice(1);
}

/**
 * One-line summary for the note list, with the redundant title heading removed
 * so the excerpt adds information instead of echoing the row above it.
 */
export function noteExcerpt(source: string, title: string, limit = 140): string {
  return blocksToPlainText(stripDuplicateTitleHeading(parseMarkdown(source), title), limit);
}

/**
 * Glues appended markdown to the body of a note.
 *
 * Only *newlines* are trimmed at the seam — trailing spaces are meaningful in
 * Markdown (two of them are a hard break), so they are left alone. The result
 * never starts with the separator and never accumulates blank lines at the end.
 */
export function joinNoteContent(
  previous: string,
  addition: string,
  separator = '\n\n',
): string {
  if (previous.length === 0) return addition;
  if (addition.length === 0) return previous;

  return `${previous.replace(/\n+$/, '')}${separator}${addition.replace(/^\n+/, '')}`;
}
