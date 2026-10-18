import 'server-only';

import { randomUUID } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { webhooks } from '@/lib/db/schema';
import { serializeWebhook } from '@/lib/domain/serialize';
import type { WebhookDTO, WebhookTestResultDTO } from '@/lib/types';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_USER_AGENT,
  matchesWebhookEvent,
} from '@/lib/webhook';
import { buildSignatureHeader, generateWebhookSecret } from '@/lib/webhook-signature';
import type { WebhookCreateInput, WebhookUpdateInput } from '@/lib/validation';

/**
 * Outgoing webhooks.
 *
 * An endpoint is a URL plus the events it cares about. Every delivery is signed
 * with HMAC-SHA256 so the receiver can tell a request from AgentDesk from one it
 * did not send — the point of the whole feature when the receiver is n8n on the
 * same LAN.
 *
 * Delivery is best effort and never blocks the operation that produced the
 * event: a dead endpoint must not make saving a task fail.
 */

/** An endpoint that takes longer than this is considered down. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** How much of the receiver's answer is kept for the settings screen. */
const RESPONSE_PREVIEW_BYTES = 500;

type WebhookRow = typeof webhooks.$inferSelect;

export async function listWebhooks(): Promise<WebhookDTO[]> {
  const rows = await db.select().from(webhooks).orderBy(asc(webhooks.name));
  return rows.map(serializeWebhook);
}

export async function getWebhook(id: string): Promise<WebhookDTO | null> {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  return row ? serializeWebhook(row) : null;
}

export async function createWebhook(
  input: WebhookCreateInput,
): Promise<{ webhook: WebhookDTO; secret: string }> {
  const secret = generateWebhookSecret();

  const [row] = await db
    .insert(webhooks)
    .values({
      name: input.name,
      url: input.url,
      events: input.events,
      secret,
      active: input.active,
    })
    .returning();

  // The raw secret travels back exactly once, like an API token.
  return { webhook: serializeWebhook(row), secret };
}

export async function updateWebhook(
  id: string,
  input: WebhookUpdateInput,
): Promise<{ webhook: WebhookDTO; secret: string | null } | null> {
  const patch: Partial<typeof webhooks.$inferInsert> = { updatedAt: new Date() };
  let secret: string | null = null;

  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  if (input.events !== undefined) patch.events = input.events;
  if (input.active !== undefined) patch.active = input.active;

  if (input.rotateSecret) {
    secret = generateWebhookSecret();
    patch.secret = secret;
    // The old secret's delivery record no longer describes this endpoint.
    patch.lastStatus = null;
    patch.lastError = null;
  }

  const [row] = await db.update(webhooks).set(patch).where(eq(webhooks.id, id)).returning();
  if (!row) return null;

  return { webhook: serializeWebhook(row), secret };
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const rows = await db.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * The body a receiver gets.
 *
 * `data` is the same payload the SSE stream carries, deliberately: a payload
 * per event type would mean two descriptions of every event and two places to
 * keep in sync. The envelope is what says where the data came from, and `data`
 * is a notification — the receiver fetches details from the API if it needs
 * more than what changed.
 */
export type WebhookPayload = {
  event: string;
  at: string;
  delivery: string;
  webhookId: string;
  data: unknown;
};

function truncate(body: string | null): string | null {
  if (body === null) return null;
  return body.length > RESPONSE_PREVIEW_BYTES ? `${body.slice(0, RESPONSE_PREVIEW_BYTES)}…` : body;
}

/** POSTs one event, with the signature headers, and never throws. */
async function send(
  webhook: WebhookRow,
  event: string,
  payload: WebhookPayload,
): Promise<WebhookTestResultDTO> {
  const body = JSON.stringify(payload);
  const startedAt = Date.now();

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': WEBHOOK_USER_AGENT,
        [WEBHOOK_SIGNATURE_HEADER]: buildSignatureHeader(webhook.secret, body),
        [WEBHOOK_EVENT_HEADER]: event,
        [WEBHOOK_DELIVERY_HEADER]: payload.delivery,
      },
      body,
      // A receiver that hangs must not hold a socket open for ever.
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    const text = await response.text().catch(() => '');

    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: response.ok ? null : `El receptor respondió HTTP ${response.status}`,
      body: truncate(text),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Fallo de red',
      body: null,
    };
  }
}

/**
 * Records the outcome on the webhook row.
 *
 * `updatedAt` is left alone on purpose: it means "the configuration changed",
 * and a delivery is not a configuration change.
 */
async function recordDelivery(id: string, result: WebhookTestResultDTO): Promise<void> {
  await db
    .update(webhooks)
    .set({
      lastDeliveryAt: new Date(),
      lastStatus: result.status,
      lastError: result.error,
      deliveryCount: sql`${webhooks.deliveryCount} + 1`,
      failureCount: sql`${webhooks.failureCount} + ${result.ok ? 0 : 1}`,
    })
    .where(eq(webhooks.id, id));
}

/** Sends one event to every webhook subscribed to it. Fire and forget. */
export async function dispatchWebhooks(event: string, data: unknown): Promise<void> {
  try {
    const rows = await db.select().from(webhooks).where(eq(webhooks.active, true));
    const interested = rows.filter((row) => matchesWebhookEvent(row.events ?? [], event));
    if (interested.length === 0) return;

    await Promise.all(
      interested.map(async (row) => {
        const payload: WebhookPayload = {
          event,
          at: new Date().toISOString(),
          delivery: randomUUID(),
          webhookId: row.id,
          data,
        };

        const result = await send(row, event, payload);
        await recordDelivery(row.id, result);

        if (!result.ok) {
          console.error(`[webhooks] ${row.name} → ${row.url}: ${result.error}`);
        }
      }),
    );
  } catch (error) {
    // Whatever happened out here, the caller's own work already succeeded.
    console.error('[webhooks] no se pudo repartir el evento', error);
  }
}

/**
 * Sends a `test` event and waits for the answer.
 *
 * This is the only delivery whose result is returned to the caller: it exists
 * so the settings screen can say "your endpoint answered 200 in 42 ms" instead
 * of leaving the user guessing. It is recorded like any other delivery.
 */
export async function testWebhook(id: string): Promise<WebhookTestResultDTO | null> {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!row) return null;

  const payload: WebhookPayload = {
    event: 'test',
    at: new Date().toISOString(),
    delivery: randomUUID(),
    webhookId: row.id,
    data: { message: 'Ping desde AgentDesk', webhook: row.name },
  };

  const result = await send(row, 'test', payload);
  await recordDelivery(row.id, result);
  return result;
}
