'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Keeps the current page honest.
 *
 * One `EventSource` for the whole app: the server says *what* changed and the
 * page decides whether to refetch. Refreshes are debounced because a run that
 * logs fifty lines in a second should cost one render, not fifty.
 *
 * The event name is the SSE `event:` field, so listeners are registered per
 * type — `onmessage` would never fire for named events.
 */
const REFRESH_TYPES = [
  'task.changed',
  'task.comment',
  'note.changed',
  'run.updated',
  'run.artifact',
  'delegation.updated',
  'approval.requested',
  'approval.decided',
  'task.claimed',
  'activity',
];

const DEBOUNCE_MS = 400;

export function LiveUpdates() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/events');

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };

    for (const type of REFRESH_TYPES) {
      source.addEventListener(type, schedule);
    }

    // A dropped connection is the browser's problem: EventSource reconnects on
    // its own with the right `Last-Event-ID` semantics, so there is nothing to
    // do here beyond not crashing.
    source.onerror = () => undefined;

    return () => {
      for (const type of REFRESH_TYPES) {
        source.removeEventListener(type, schedule);
      }
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
