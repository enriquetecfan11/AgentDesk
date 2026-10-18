import { describe, expect, it } from 'vitest';

import {
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  plainText,
} from '@/lib/notes/markdown';

describe('parseMarkdown — block level', () => {
  it('reads headings by level', () => {
    const blocks = parseMarkdown('# Uno\n\n### Tres');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('joins wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('una frase\nque sigue\n\ny otra');
    expect(blocks).toHaveLength(2);
    const first = blocks[0] as { children: Parameters<typeof plainText>[0] };
    expect(plainText(first.children)).toBe('una frase que sigue');
  });

  it('keeps fenced code verbatim, including markup', () => {
    const blocks = parseMarkdown('```ts\nconst a = **no** <b>\n```');
    expect(blocks[0]).toEqual({ type: 'code', lang: 'ts', value: 'const a = **no** <b>' });
  });

  it('reads unordered and ordered lists', () => {
    const [unordered] = parseMarkdown('- uno\n- dos');
    expect(unordered).toMatchObject({ type: 'list', ordered: false });
    expect((unordered as { items: unknown[] }).items).toHaveLength(2);

    const [ordered] = parseMarkdown('1. uno\n2. dos');
    expect(ordered).toMatchObject({ type: 'list', ordered: true });
  });

  it('does not mix ordered and unordered items into one list', () => {
    const blocks = parseMarkdown('- uno\n1. dos');
    expect(blocks).toHaveLength(2);
  });

  it('reads task list checkboxes', () => {
    const [list] = parseMarkdown('- [ ] pendiente\n- [x] hecho');
    const items = (list as { items: { checked: boolean | null }[] }).items;
    expect(items[0].checked).toBe(false);
    expect(items[1].checked).toBe(true);
  });

  it('reads quotes and horizontal rules', () => {
    expect(parseMarkdown('> cita')[0]).toMatchObject({ type: 'quote' });
    expect(parseMarkdown('---')[0]).toEqual({ type: 'hr' });
  });
});

describe('parseInline', () => {
  it('reads bold, italic and strikethrough', () => {
    expect(parseInline('**fuerte**')[0]).toMatchObject({ type: 'strong' });
    expect(parseInline('*cursiva*')[0]).toMatchObject({ type: 'em' });
    expect(parseInline('~~tachado~~')[0]).toMatchObject({ type: 'del' });
  });

  it('nests emphasis inside strong', () => {
    const nodes = parseInline('**negrita *y cursiva***');
    expect(nodes[0]).toMatchObject({ type: 'strong' });
    const children = (nodes[0] as { children: { type: string }[] }).children;
    expect(children.some((child) => child.type === 'em')).toBe(true);
  });

  it('does not turn arithmetic or snake_case into emphasis', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }]);
    expect(parseInline('mi_variable_larga')).toEqual([
      { type: 'text', value: 'mi_variable_larga' },
    ]);
  });

  it('reads code spans and does not parse markup inside them', () => {
    expect(parseInline('usa `**esto**` así')).toEqual([
      { type: 'text', value: 'usa ' },
      { type: 'code', value: '**esto**' },
      { type: 'text', value: ' así' },
    ]);
  });

  it('reads links and images', () => {
    expect(parseInline('[texto](https://x.dev)')[0]).toMatchObject({
      type: 'link',
      href: 'https://x.dev',
    });
    expect(parseInline('![alt](img.png)')[0]).toMatchObject({ type: 'image', src: 'img.png' });
  });

  it('reads wiki links, with alias and section', () => {
    expect(parseInline('[[Otra nota]]')[0]).toEqual({ type: 'wikilink', target: 'Otra nota' });
    expect(parseInline('[[Otra nota|ver]]')[0]).toEqual({ type: 'wikilink', target: 'Otra nota' });
    expect(parseInline('[[Otra nota#Parte]]')[0]).toEqual({
      type: 'wikilink',
      target: 'Otra nota',
    });
  });

  it('honours backslash escapes', () => {
    expect(parseInline('un \\* asterisco literal')).toEqual([
      { type: 'text', value: 'un * asterisco literal' },
    ]);
  });

  it('never returns raw HTML nodes', () => {
    // The renderer builds React elements from this tree, so script tags must
    // come out as plain text.
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { type: 'text', value: '<script>alert(1)</script>' },
    ]);
  });

  it('stops recursing instead of blowing the stack', () => {
    const deep = `${'*'.repeat(2)}${'x'.repeat(1)}`;
    expect(() => parseInline(deep.repeat(40))).not.toThrow();
  });
});

describe('markdownToPlainText', () => {
  it('strips the markup', () => {
    const source = '# Título\n\n**negrita** y `código` y [un enlace](https://x.dev)';
    expect(markdownToPlainText(source)).toBe('Título negrita y código y un enlace');
  });

  it('turns wiki links into their title', () => {
    expect(markdownToPlainText('ver [[Otra nota]]')).toBe('ver Otra nota');
  });

  it('truncates with an ellipsis when asked', () => {
    const text = markdownToPlainText('una '.repeat(40), 20);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(21);
  });
});
