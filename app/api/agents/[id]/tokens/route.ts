import { HttpError, json, parseJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { AgentNotFoundError, createToken, listTokens } from '@/lib/domain/agents';
import { tokenCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/agents/:id/tokens — prefixes and scopes; never the secrets. */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Agente no encontrado');

    return json({ tokens: await listTokens(id) });
  });
}

/**
 * POST /api/agents/:id/tokens
 *
 * The response is the only time the raw token is visible. The UI shows it once,
 * with a copy button; afterwards only its prefix can be seen.
 */
export async function POST(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Agente no encontrado');
    const input = await parseJson(request, tokenCreateSchema);

    let created;
    try {
      created = await createToken(id, input);
    } catch (error) {
      if (error instanceof AgentNotFoundError) throw new HttpError(404, 'Agente no encontrado');
      throw error;
    }

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'agent.token_created',
      entityType: 'agent',
      entityId: id,
      meta: { name: input.name, scopes: input.scopes, prefix: created.token.tokenPrefix },
    });

    return json(created, { status: 201 });
  });
}
