import 'server-only';

import { z } from 'zod';

import {
  DEFAULT_APPROVAL_TTL_SECONDS,
  DEFAULT_HEARTBEAT_SECONDS,
  DEFAULT_LEASE_TTL_SECONDS,
} from '@/lib/agent-flow/lease';

/**
 * A duration in seconds, read from a string.
 *
 * Bounded on both ends on purpose: a 5-second lease would thrash, and a
 * one-week lease is indistinguishable from no lease at all.
 */
function seconds(fallback: number) {
  return z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .refine((value) => Number.isFinite(value) && value >= 30 && value <= 604_800, {
      message: 'must be a number of seconds between 30 and 604800 (7 days)',
    });
}

/**
 * Environment validation.
 *
 * Validated lazily (on first access at request time) instead of at module load,
 * so `next build` never needs runtime configuration. Fails fast with a readable
 * message rather than throwing "undefined" deep inside a request.
 *
 * APP_BASE_URL must never be "localhost": the app is reached from other devices
 * on the LAN and, later, from Proxmox.
 */
const schema = z.object({
  APP_BASE_URL: z
    .string()
    .min(1, 'APP_BASE_URL is required')
    .refine((value) => /^https?:\/\//.test(value), {
      message: 'APP_BASE_URL must start with http:// or https://',
    })
    .refine((value) => !/\/\/localhost\b/.test(value), {
      message: 'APP_BASE_URL must not use "localhost" — use the LAN IP or hostname.',
    }),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  UPLOADS_DIR: z.string().default('./uploads'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Deadlines for the agent flow. Defaults live in `lib/agent-flow/lease.ts`
  // next to the arithmetic that uses them; these only let a deployment widen
  // or tighten them without a rebuild.
  AGENTDESK_LEASE_TTL_SECONDS: seconds(DEFAULT_LEASE_TTL_SECONDS),
  AGENTDESK_HEARTBEAT_SECONDS: seconds(DEFAULT_HEARTBEAT_SECONDS),
  AGENTDESK_APPROVAL_TTL_SECONDS: seconds(DEFAULT_APPROVAL_TTL_SECONDS),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse({
    APP_BASE_URL: process.env.APP_BASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    UPLOADS_DIR: process.env.UPLOADS_DIR,
    NODE_ENV: process.env.NODE_ENV,
    AGENTDESK_LEASE_TTL_SECONDS: process.env.AGENTDESK_LEASE_TTL_SECONDS,
    AGENTDESK_HEARTBEAT_SECONDS: process.env.AGENTDESK_HEARTBEAT_SECONDS,
    AGENTDESK_APPROVAL_TTL_SECONDS: process.env.AGENTDESK_APPROVAL_TTL_SECONDS,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** True when the app is served over HTTPS, which decides the cookie Secure flag. */
export function isSecureOrigin(): boolean {
  return getEnv().APP_BASE_URL.startsWith('https://');
}
