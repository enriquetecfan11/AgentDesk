import 'server-only';

/**
 * In-process fan-out for Server-Sent Events.
 *
 * The app runs as a single standalone Node process inside one container, so a
 * plain set of callbacks is enough — no Redis, no external broker. If it is
 * ever scaled to several replicas this is the one module that would have to be
 * swapped for a shared transport.
 *
 * Events carry no secrets: an agent only ever receives what a token holder
 * would be able to fetch anyway.
 */

export type RealtimeEvent = {
  /** e.g. `run.log`, `run.updated`, `task.changed`, `activity`. */
  type: string;
  at: string;
  data: unknown;
};

type Subscriber = (event: RealtimeEvent) => void;

const subscribers = new Set<Subscriber>();

/** How often an idle stream sends a comment line to keep the connection open. */
const HEARTBEAT_MS = 25_000;

/**
 * Notifies every open stream. A broken subscriber must never take down the
 * request that published the event, so its errors are swallowed.
 */
export function publish(type: string, data: unknown = null): void {
  if (subscribers.size === 0) return;

  const event: RealtimeEvent = { type, at: new Date().toISOString(), data };

  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch (error) {
      console.error('[realtime] suscriptor roto', error);
    }
  }
}

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function subscriberCount(): number {
  return subscribers.size;
}

/**
 * Wraps a handler in an SSE response.
 *
 * `filter` lets a stream receive only what its owner is allowed to see; for
 * now every authenticated caller may see the same coarse events.
 */
export function eventStream(
  options: { filter?: (event: RealtimeEvent) => boolean; hello?: unknown } = {},
): Response {
  const encoder = new TextEncoder();

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const write = (event: { type: string; data?: unknown }) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event.data ?? null)}\n\n`);
      };

      write({ type: 'hello', data: options.hello ?? { at: new Date().toISOString() } });

      unsubscribe = subscribe((event) => {
        if (options.filter && !options.filter(event)) return;
        write({ type: event.type, data: event.data });
      });

      heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      heartbeat = null;
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Tells a reverse proxy not to buffer the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
