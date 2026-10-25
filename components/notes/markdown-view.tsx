'use client';

import { Fragment, useMemo } from 'react';

import {
  parseMarkdown,
  stripDuplicateTitleHeading,
  type BlockNode,
  type InlineNode,
} from '@/lib/notes/markdown';
import { normalizeTitle } from '@/lib/notes/wikilinks';
import type { NoteRef } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Renders a note.
 *
 * The parser produces a node tree, so this builds React elements and never
 * hands a string to `dangerouslySetInnerHTML`: a note cannot inject markup,
 * no matter what it contains.
 */
export function MarkdownView({
  source,
  title,
  noteIndex,
  onOpenNote,
  onCreateNote,
  className,
}: {
  source: string;
  /** The note's title: a leading `# Título` that repeats it is not rendered. */
  title?: string;
  /** Every existing note, keyed by normalised title, to resolve `[[links]]`. */
  noteIndex: Map<string, NoteRef>;
  onOpenNote: (id: string) => void;
  /** Offered when a link points at a note that does not exist yet. */
  onCreateNote?: (title: string) => void;
  className?: string;
}) {
  const blocks = useMemo(
    () => stripDuplicateTitleHeading(parseMarkdown(source), title),
    [source, title],
  );

  if (blocks.length === 0) {
    // A body that was only the redundant title heading has nothing left to
    // show; the title is already above.
    if (source.trim().length > 0) return null;

    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Esta nota está vacía. Pulsa «Editar» para escribir.
      </p>
    );
  }

  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          noteIndex={noteIndex}
          onOpenNote={onOpenNote}
          onCreateNote={onCreateNote}
        />
      ))}
    </div>
  );
}

function BlockView({
  block,
  noteIndex,
  onOpenNote,
  onCreateNote,
}: {
  block: BlockNode;
  noteIndex: Map<string, NoteRef>;
  onOpenNote: (id: string) => void;
  onCreateNote?: (title: string) => void;
}) {
  switch (block.type) {
    case 'heading': {
      const sizes: Record<number, string> = {
        1: 'mt-6 mb-3 text-xl font-semibold tracking-tight',
        2: 'mt-6 mb-2 text-lg font-semibold tracking-tight',
        3: 'mt-5 mb-2 text-base font-semibold',
        4: 'mt-4 mb-1 text-sm font-semibold',
        5: 'mt-4 mb-1 text-sm font-medium',
        6: 'mt-4 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground',
      };

      const Heading = `h${block.level}` as 'h1';

      return (
        <Heading className={sizes[block.level]}>
          <Inline
            nodes={block.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </Heading>
      );
    }

    case 'paragraph':
      return (
        <p className="my-2.5">
          <Inline
            nodes={block.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </p>
      );

    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';

      return (
        <List className={cn('my-2.5 space-y-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, index) => (
            <li key={index} className={cn(item.checked !== null && 'list-none')}>
              {item.checked !== null ? (
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    tabIndex={-1}
                    aria-hidden
                    className="mt-1 size-3.5 shrink-0 accent-[hsl(var(--accent))]"
                  />
                  <span className={cn(item.checked && 'text-muted-foreground line-through')}>
                    <Inline
                      nodes={item.children}
                      noteIndex={noteIndex}
                      onOpenNote={onOpenNote}
                      onCreateNote={onCreateNote}
                    />
                  </span>
                </span>
              ) : (
                <Inline
                  nodes={item.children}
                  noteIndex={noteIndex}
                  onOpenNote={onOpenNote}
                  onCreateNote={onCreateNote}
                />
              )}
            </li>
          ))}
        </List>
      );
    }

    case 'code':
      return (
        <pre className="my-3 overflow-x-auto rounded-md border border-border bg-muted/60 p-3 text-xs">
          <code className="font-mono">{block.value}</code>
        </pre>
      );

    case 'quote':
      return (
        <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">
          <Inline
            nodes={block.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </blockquote>
      );

    case 'hr':
      return <hr className="my-5 border-border" />;
  }
}

function Inline({
  nodes,
  noteIndex,
  onOpenNote,
  onCreateNote,
}: {
  nodes: InlineNode[];
  noteIndex: Map<string, NoteRef>;
  onOpenNote: (id: string) => void;
  onCreateNote?: (title: string) => void;
}) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          <InlineView
            node={node}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </Fragment>
      ))}
    </>
  );
}

function InlineView({
  node,
  noteIndex,
  onOpenNote,
  onCreateNote,
}: {
  node: InlineNode;
  noteIndex: Map<string, NoteRef>;
  onOpenNote: (id: string) => void;
  onCreateNote?: (title: string) => void;
}) {
  switch (node.type) {
    case 'text':
      return <>{node.value}</>;

    case 'strong':
      return (
        <strong className="font-semibold">
          <Inline
            nodes={node.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </strong>
      );

    case 'em':
      return (
        <em className="italic">
          <Inline
            nodes={node.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </em>
      );

    case 'del':
      return (
        <del className="text-muted-foreground line-through">
          <Inline
            nodes={node.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </del>
      );

    case 'code':
      return (
        <code className="rounded border border-border bg-muted/60 px-1 py-0.5 font-mono text-[0.85em]">
          {node.value}
        </code>
      );

    case 'br':
      return <br />;

    case 'link':
      // External links open in a new tab; `noopener` closes the reverse-tab
      // attack window that `target="_blank"` opens.
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          <Inline
            nodes={node.children}
            noteIndex={noteIndex}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
          />
        </a>
      );

    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- user content, any origin
        <img
          src={node.src}
          alt={node.alt}
          loading="lazy"
          className="my-2 max-h-96 rounded-md border border-border"
        />
      );

    case 'wikilink': {
      const target = noteIndex.get(normalizeTitle(node.target));

      if (target) {
        return (
          <button
            type="button"
            onClick={() => onOpenNote(target.id)}
            className="rounded-sm text-foreground underline decoration-accent underline-offset-2 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {node.target}
          </button>
        );
      }

      return (
        <button
          type="button"
          onClick={() => onCreateNote?.(node.target)}
          disabled={!onCreateNote}
          title={`La nota «${node.target}» no existe todavía`}
          className={cn(
            'rounded-sm text-muted-foreground underline decoration-dashed underline-offset-2',
            onCreateNote && 'hover:bg-muted hover:text-foreground',
          )}
        >
          {node.target}
        </button>
      );
    }
  }
}
