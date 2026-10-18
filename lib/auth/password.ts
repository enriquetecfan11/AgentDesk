import 'server-only';

import { hash, verify } from '@node-rs/argon2';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/constants';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

/**
 * Password hashing with Argon2id.
 *
 * Parameters are the OWASP recommendation (19 MiB, 2 iterations, 1 lane).
 * They are also @node-rs/argon2's defaults, but pinned explicitly so a library
 * upgrade can never silently weaken stored hashes.
 */
const PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/**
 * Verifies a password against a stored hash. Returns false (instead of throwing)
 * for malformed hashes so a corrupted row cannot crash a request.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, PARAMS);
  } catch {
    return false;
  }
}

// A real Argon2 hash of a random value. When the email does not exist we still
// verify against this, so response time does not reveal whether the account is
// registered.
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash('agentdesk-timing-equaliser', PARAMS);
  return dummyHashPromise;
}

export async function wastePasswordTime(password: string): Promise<void> {
  const dummy = await getDummyHash();
  await verifyPassword(dummy, password);
}
