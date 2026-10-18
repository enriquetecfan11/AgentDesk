import { eq } from 'drizzle-orm';

import { HttpError, json, parseJson, route } from '@/lib/api/http';
import { verifyPassword, wastePasswordTime } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { logActivity } from '@/lib/domain/activity';
import { loginSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login */
export async function POST(request: Request) {
  return route(async () => {
    const input = await parseJson(request, loginSchema);

    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

    if (!user) {
      // Burn comparable time so response latency does not reveal whether the
      // email is registered.
      await wastePasswordTime(input.password);
      throw new HttpError(401, 'Credenciales inválidas');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) throw new HttpError(401, 'Credenciales inválidas');

    const token = await createSession(user.id);
    await setSessionCookie(token);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'user.signed_in',
      entityType: 'user',
      entityId: user.id,
    });

    return json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  });
}
