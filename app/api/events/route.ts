import { requireApiUser, route } from '@/lib/api/http';
import { subscriberCount, eventStream } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events
 *
 * The UI's live channel: task changes, agent runs, streams of log lines and
 * anything that lands in the timeline. Payloads are small on purpose — the
 * client decides what to refetch, and one subscription serves the whole app
 * instead of one poll per panel.
 */
export async function GET() {
  return route(async () => {
    await requireApiUser();

    return eventStream({
      hello: { at: new Date().toISOString(), subscribers: subscriberCount() },
    });
  });
}
