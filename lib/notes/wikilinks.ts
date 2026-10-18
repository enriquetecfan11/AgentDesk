/**
 * `[[wiki links]]`, the Obsidian convention.
 *
 * A link targets a note by title. Titles are therefore the identity of a note
 * in a vault, which is why the database keeps a unique index on them.
 */

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/** Strips the `|alias` and `#section` parts of a link target. */
export function cleanWikiTarget(raw: string): string {
  return raw.split('|')[0].split('#')[0].trim();
}

/** Every distinct target in the order it appears. */
export function extractWikiLinks(markdown: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  for (const match of markdown.matchAll(WIKILINK)) {
    const target = cleanWikiTarget(match[1]);
    if (target.length === 0) continue;

    const key = normalizeTitle(target);
    if (seen.has(key)) continue;

    seen.add(key);
    targets.push(target);
  }

  return targets;
}

/**
 * Comparison key for titles and for wiki targets.
 *
 * Accents and case are ignored and inner whitespace is collapsed, so
 * `[[Gestión de  incidencias]]` still resolves to "Gestión de incidencias".
 */
export function normalizeTitle(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Stable file name for a note, used by the Markdown export.
 *
 * Obsidian derives the note title from the file name, so this must round-trip:
 * "Gestión de incidencias.md" → "Gestión de incidencias".
 */
export function noteFileName(title: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    // A title ending in a replaced character would produce "nota-.md".
    .replace(/^[-\s]+/, '')
    .replace(/[-\s]+$/, '')
    .trim();

  return `${safe.length > 0 ? safe : 'Sin título'}.md`;
}

/** Title of a note created from a file name. */
export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/^.*[/\\]/, '')
    .replace(/\.md$/i, '')
    .trim();
}
