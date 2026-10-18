import { describe, expect, it } from 'vitest';

import {
  cleanWikiTarget,
  extractWikiLinks,
  normalizeTitle,
  noteFileName,
  titleFromFileName,
} from '@/lib/notes/wikilinks';

describe('cleanWikiTarget', () => {
  it('drops the alias', () => {
    expect(cleanWikiTarget('Gestión de incidencias|el manual')).toBe('Gestión de incidencias');
  });

  it('drops the section', () => {
    expect(cleanWikiTarget('Proxmox#Red')).toBe('Proxmox');
  });

  it('drops the alias and the section together, in any order', () => {
    expect(cleanWikiTarget('Proxmox#Red|servidor')).toBe('Proxmox');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanWikiTarget('  Notas  ')).toBe('Notas');
  });
});

describe('extractWikiLinks', () => {
  it('finds every distinct target in order of appearance', () => {
    const md = 'ver [[Uno]], luego [[Dos]] y otra vez [[Uno]]';
    expect(extractWikiLinks(md)).toEqual(['Uno', 'Dos']);
  });

  it('ignores case and accents when deciding what is a duplicate', () => {
    const md = '[[Gestion de incidencias]] y [[Gestión de  incidencias]]';
    expect(extractWikiLinks(md)).toHaveLength(1);
  });

  it('returns the target without alias or section', () => {
    expect(extractWikiLinks('[[Nota|como se ve]] y [[Otra#parte]]')).toEqual(['Nota', 'Otra']);
  });

  it('ignores empty links', () => {
    expect(extractWikiLinks('[[]] y [[   ]] y [[Válida]]')).toEqual(['Válida']);
  });

  it('does not cross a newline, so an unclosed link is not a link', () => {
    expect(extractWikiLinks('[[Empieza\ntermina]]')).toEqual([]);
  });

  it('finds links inside headings, lists and tables alike', () => {
    const md = ['# [[Título]]', '- [[Elemento]]', '| [[Celda]] |'].join('\n');
    expect(extractWikiLinks(md)).toEqual(['Título', 'Elemento', 'Celda']);
  });

  it('returns nothing for text without links', () => {
    expect(extractWikiLinks('sin enlaces aquí')).toEqual([]);
  });
});

describe('normalizeTitle', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeTitle('GESTIÓN')).toBe('gestion');
  });

  it('collapses inner whitespace and trims the ends', () => {
    expect(normalizeTitle('  dos   espacios  ')).toBe('dos espacios');
  });
});

describe('noteFileName', () => {
  it('appends the .md extension', () => {
    expect(noteFileName('Gestión de incidencias')).toBe('Gestión de incidencias.md');
  });

  it('replaces characters a file system would reject, and never leaves a trailing dash', () => {
    expect(noteFileName('duda: ¿esto/o aquello?')).toBe('duda- ¿esto-o aquello.md');
  });

  it('round-trips through titleFromFileName', () => {
    const title = 'Gestión de incidencias';
    expect(titleFromFileName(noteFileName(title))).toBe(title);
  });

  it('falls back to a name for an empty title instead of producing ".md"', () => {
    expect(noteFileName('///')).toBe('Sin título.md');
  });
});

describe('titleFromFileName', () => {
  it('strips directories and the extension', () => {
    expect(titleFromFileName('vault/proyectos/Proxmox.md')).toBe('Proxmox');
    expect(titleFromFileName('C:\\vault\\Proxmox.md')).toBe('Proxmox');
  });

  it('accepts the extension in any case', () => {
    expect(titleFromFileName('Proxmox.MD')).toBe('Proxmox');
  });
});
