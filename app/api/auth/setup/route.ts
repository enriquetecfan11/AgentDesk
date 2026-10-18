import { eq } from 'drizzle-orm';

import { HttpError, json, parseJson, route } from '@/lib/api/http';
import { hashPassword } from '@/lib/auth/password';
import { countUsers, createSession, setSessionCookie } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { logActivity } from '@/lib/domain/activity';
import { setupSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/setup → whether the first-run wizard is still available. */
export async function GET() {
  return route(async () => json({ available: (await countUsers()) === 0 }));
}

/**
 * POST /api/auth/setup — creates the first user.
 *
 * Only allowed while the installation has zero users. After that it returns 409
 * and there is no way to re-open it (additional users are created from
 * Settings in a later phase).
 */
export async function POST(request: Request) {
  return route(async () => {
    const input = await parseJson(request, setupSchema);

    if ((await countUsers()) > 0) {
      throw new HttpError(409, 'Ya existe un usuario en esta instalación');
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) throw new HttpError(409, 'Ese email ya está registrado');

    const passwordHash = await hashPassword(input.password);

    const [user] = await db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash })
      .returning({ id: users.id, email: users.email, name: users.name });

    const token = await createSession(user.id);
    await setSessionCookie(token);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      meta: { email: user.email, firstUser: true },
    });

    return json({ user }, { status: 201 });
  });
}
