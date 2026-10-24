import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { isSecureRequest } from '@/lib/base-url';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';

export const SESSION_COOKIE = 'ad_session';

/** 30 days. No sliding renewal, no absolute cap — this is a local deployment. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * Only the hash of the token is persisted, so a database dump cannot be
 * replayed as a session. The token is 256 bits of randomness, which is why a
 * plain SHA-256 is enough (no salt or pepper needed).
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await db.insert(sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return token;
}

/**
 * Writes the session cookie. Only callable from a Route Handler, because
 * `cookies()` is read-only inside Server Components.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Per request, not from APP_BASE_URL: the same install may be plain HTTP on
    // the LAN and HTTPS through a proxy, and a `Secure` cookie sent over HTTP
    // is silently dropped by the browser.
    secure: await isSecureRequest(),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Resolves the current user, or null. Never throws for a missing session. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** For Server Components and layouts: redirects to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }

  await clearSessionCookie();
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length;
}
