import { describe, expect, it } from 'vitest';

import {
  markdownFileToNote,
  noteToMarkdownFile,
  parseFrontmatter,
  stringifyFrontmatter,
} from '@/lib/notes/frontmatter';
import { extractWikiLinks, normalizeTitle, noteFileName } from '@/lib/notes/wikilinks';

describe('parseFrontmatter', () => {
  it('returns the body untouched when there is no frontmatter', () => {
    const { data, body } = parseFrontmatter('# Hola\n\ntexto');
    expect(data).toEqual({});
    expect(body).toBe('# Hola\n\ntexto');
  });

  it('reads scalars and inline lists', () => {
    const { data, body } = parseFrontmatter(
      '---\ntitle: Mi nota\ntags: [seguridad, wazuh]\n---\n\ncuerpo',
    );

    expect(data.title).toBe('Mi nota');
    expect(data.tags).toEqual(['seguridad', 'wazuh']);
    expect(body).toBe('cuerpo');
  });

  it('reads block lists', () => {
    const { data } = parseFrontmatter('---\ntags:\n  - uno\n  - dos\n---\n\ncuerpo');
    expect(data.tags).toEqual(['uno', 'dos']);
  });

  it('keeps unknown keys, so a round-trip does not lose metadata', () => {
    const { data } = parseFrontmatter('---\naliases: [Viejo nombre]\ncssclasses: wide\n---\nx');
    expect(data.aliases).toEqual(['Viejo nombre']);
    expect(data.cssclasses).toBe('wide');
  });

  it('ignores an unterminated block', () => {
    const { data, body } = parseFrontmatter('---\ntitle: x\n\nsin cierre');
    expect(data).toEqual({});
    expect(body).toContain('title: x');
  });

  it('round-trips through stringifyFrontmatter', () => {
    const original = { title: 'Mi nota', tags: ['a', 'b'] };
    const text = stringifyFrontmatter(original, 'cuerpo');
    expect(text.startsWith('---\n')).toBe(true);
    expect(parseFrontmatter(text).data).toEqual(original);
    expect(parseFrontmatter(text).body).toBe('cuerpo');
  });

  it('omits empty keys rather than writing "key: "', () => {
    expect(stringifyFrontmatter({ title: 'x', tags: [] }, 'cuerpo')).toBe(
      '---\ntitle: x\n---\n\ncuerpo',
    );
  });
});

describe('noteToMarkdownFile / markdownFileToNote', () => {
  it('round-trips a note', () => {
    const file = noteToMarkdownFile({
      title: 'Gestión de incidencias',
      contentMd: '# Gestión\n\nver [[Otras notas]]',
      tags: ['seguridad'],
    });

    expect(file.fileName).toBe('Gestión de incidencias.md');

    const note = markdownFileToNote(file.fileName, file.contents);
    expect(note.title).toBe('Gestión de incidencias');
    expect(note.contentMd).toBe('# Gestión\n\nver [[Otras notas]]');
    expect(note.tags).toEqual(['seguridad']);
  });

  it('prefers the frontmatter title over the file name', () => {
    const note = markdownFileToNote('fichero.md', '---\ntitle: Del frontmatter\n---\nx');
    expect(note.title).toBe('Del frontmatter');
  });

  it('falls back to the file name, then to the first heading', () => {
    expect(markdownFileToNote('Desde el fichero.md', 'texto').title).toBe('Desde el fichero');
    expect(markdownFileToNote('', '# Un título\n\ncuerpo').title).toBe('Un título');
  });

  it('sanitises characters a file system would reject', () => {
    expect(noteFileName('a/b:c*d?e"f<g>h|i#j^k[l]')).toBe('a-b-c-d-e-f-g-h-i-j-k-l.md');
  });
});

describe('extractWikiLinks', () => {
  it('returns distinct targets in order', () => {
    const md = '[[Uno]] y [[Dos]] y otra vez [[Uno|alias]]';
    expect(extractWikiLinks(md)).toEqual(['Uno', 'Dos']);
  });

  it('ignores the alias and the section', () => {
    expect(extractWikiLinks('[[Nota#Parte]]')).toEqual(['Nota']);
  });

  it('ignores empty links', () => {
    expect(extractWikiLinks('[[]] y [[   ]]')).toEqual([]);
  });

  it('finds links inside code fences too, which is what Obsidian does', () => {
    expect(extractWikiLinks('```\n[[Dentro]]\n```')).toEqual(['Dentro']);
  });
});

describe('normalizeTitle', () => {
  it('ignores case, accents and extra whitespace', () => {
    expect(normalizeTitle('  Gestión   DE Incidencias ')).toBe('gestion de incidencias');
  });
});
