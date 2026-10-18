import { json, route } from '@/lib/api/http';
import { revokeCurrentSession } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — deletes the session row and clears the cookie. */
export async function POST() {
  return route(async () => {
    await revokeCurrentSession();
    return json({ ok: true });
  });
}
