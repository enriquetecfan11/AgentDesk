import { json, requireApiUser, route } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — the signed-in user, or 401. */
export async function GET() {
  return route(async () => {
    const user = await requireApiUser();
    return json({ user });
  });
}
