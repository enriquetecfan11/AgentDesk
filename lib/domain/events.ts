import 'server-only';

import { dispatchWebhooks } from '@/lib/domain/webhooks';
import { publish } from '@/lib/realtime';

/**
 * Fan-out of a domain event.
 *
 * Two consumers with the same vocabulary: the open SSE streams and the
 * configured webhooks. Keeping them behind one call means a new event cannot be
 * forgotten in the webhook path — which is exactly the kind of bug that goes
 * unnoticed for weeks in an automation setup.
 *
 * The webhook side is not awaited: deliveries happen after (or alongside) the
 * response, and a slow endpoint never delays the user's own request.
 */
export function emitEvent(type: string, data: unknown = null): void {
  publish(type, data);
  void dispatchWebhooks(type, data);
}
