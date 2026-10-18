/**
 * HMAC-SHA256 signing for outgoing webhooks.
 *
 * The scheme is the one Stripe and friends settled on, and for one reason: it
 * lets the receiver reject a replayed request without trusting its own clock.
 *
 *   X-AgentDesk-Signature: t=1730000000,v1=<hex hmac of "1730000000.<body>">
 *
 * The timestamp is part of the signed bytes, so a captured request cannot be
 * replayed later with a fresh header — the signature would no longer match.
 *
 * Node-only: it uses `node:crypto`. Kept free of `server-only` so the rules can
 * be unit tested without a server context.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { WEBHOOK_SECRET_PREFIX } from '@/lib/webhook';

export const WEBHOOK_SECRET_BYTES = 32;

/** How far apart the two clocks may be, in seconds, for a request to count. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * The secret is stored in clear text, unlike an API token.
 *
 * It has to be: signing requires the original value. A hash would make it
 * impossible to produce the signature, and the receiver already holds the same
 * secret, so hashing it here would protect nothing.
 */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(WEBHOOK_SECRET_BYTES).toString('base64url')}`;
}

/** The exact bytes that get signed: timestamp, a dot, then the JSON body. */
export function signedContent(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

export function signWebhookPayload(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(signedContent(timestampSeconds, body)).digest('hex');
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function buildSignatureHeader(
  secret: string,
  body: string,
  timestampSeconds: number = nowSeconds(),
): string {
  return `t=${timestampSeconds},v1=${signWebhookPayload(secret, timestampSeconds, body)}`;
}

/** Reads `t=...,v1=...` back. Extra fields are ignored, so the format can grow. */
export function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = new Map(
    header
      .split(',')
      .map((piece) => piece.trim().split('=', 2))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );

  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1');

  if (!Number.isFinite(timestamp) || !signature) return null;
  return { timestamp, signature };
}

/**
 * What a receiver runs on every incoming request.
 *
 * Exported so it is unit tested and so the reference receiver in
 * `scripts/webhook-receiver.mjs` has a counterpart to mirror: an implementation
 * nobody verifies is not much of a contract.
 */
export function verifyWebhookSignature(options: {
  secret: string;
  header: string | null;
  body: string;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  if (!options.header) return false;

  const parsed = parseSignatureHeader(options.header);
  if (!parsed) return false;

  const tolerance = options.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  const now = options.now ?? nowSeconds();
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const expected = Buffer.from(
    signWebhookPayload(options.secret, parsed.timestamp, options.body),
    'utf8',
  );
  const received = Buffer.from(parsed.signature, 'utf8');

  // Constant-time: comparing with `===` would leak the secret one byte at a
  // time to anyone who can measure the response.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
