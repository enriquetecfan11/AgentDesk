'use client';

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

type TouchDragHandlers = {
  onStart: () => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onCancel?: () => void;
};

/**
 * Pointer-based dragging for touch screens.
 *
 * HTML5 drag-and-drop (`draggable` + `dragstart`) is not implemented on
 * Android browsers and is unreliable on iOS, so the boards also expose a small
 * grip. It is only rendered for coarse pointers; a mouse keeps dragging the
 * card itself.
 *
 * The grip carries `touch-action: none`, so the browser never turns the
 * gesture into a scroll mid-drag — the reason this lives on a handle instead of
 * the whole card, which must stay scrollable.
 */
export function useTouchDrag({ onStart, onMove, onDrop, onCancel }: TouchDragHandlers) {
  const active = useRef(false);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      active.current = true;
      onStart();
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (!active.current) return;
      event.preventDefault();
      onMove(event.clientX, event.clientY);
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (!active.current) return;
      active.current = false;
      onDrop(event.clientX, event.clientY);
    },
    onPointerCancel() {
      if (!active.current) return;
      active.current = false;
      onCancel?.();
    },
  };
}

/**
 * The column under a screen point.
 *
 * Columns advertise themselves with `data-drop-status` (and, on the global
 * board, `data-drop-project`), so the same helper works for both Kanbans
 * without knowing anything about their component tree.
 */
export function dropZoneAt(x: number, y: number): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const element = document.elementFromPoint(x, y);
  return element instanceof Element ? element.closest<HTMLElement>('[data-drop-status]') : null;
}

/** Reads the project a column belongs to; `NONE` is the "no project" lane. */
export function dropProject(zone: HTMLElement | null, none: string): string | null | undefined {
  const raw = zone?.dataset.dropProject;
  if (raw === undefined) return undefined;
  return raw === none ? null : raw;
}
