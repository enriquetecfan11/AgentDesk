import { HttpError, json, parseJson, requireUuid, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { createArtifact, getRun, listArtifacts } from '@/lib/domain/runs';
import { artifactCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/runs/:id/artifacts */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:read');
    const id = requireUuid((await params).id, 'Run no encontrado');

    const run = await getRun(id);
    if (!run) throw new HttpError(404, 'Run no encontrado');
    if (run.agentId !== actor.agentId) {
      throw new HttpError(403, 'Este run no es de este agente');
    }

    return json({ artifacts: await listArtifacts({ runId: id }) });
  });
}

/**
 * POST /api/v1/runs/:id/artifacts
 *
 * `kind: 'text'` sends the body inline; `kind: 'file'` sends it base64 and the
 * server writes it under `UPLOADS_DIR`. Plain JSON is used instead of
 * `multipart/form-data` so an agent needs nothing but an HTTP client, and the
 * size cap in the schema keeps a runaway agent from filling the disk.
 */
export async function POST(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:write');
    const id = requireUuid((await params).id, 'Run no encontrado');

    const run = await getRun(id);
    if (!run) throw new HttpError(404, 'Run no encontrado');
    if (run.agentId !== actor.agentId) {
      throw new HttpError(403, 'Este run no es de este agente');
    }

    const input = await parseJson(request, artifactCreateSchema);
    const artifact = await createArtifact({ ...input, runId: id, taskId: input.taskId ?? run.taskId });

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'artifact.created',
      entityType: 'artifact',
      entityId: artifact.id,
      meta: { name: artifact.name, kind: artifact.kind, runId: id, via: 'api' },
    });

    return json({ artifact }, { status: 201 });
  });
}
