import { HttpError, json, parseJson, requireUuid, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { getRunDetail, updateRun } from '@/lib/domain/runs';
import { runUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/runs/:id — the run with its logs and artifacts. */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:read');
    const id = requireUuid((await params).id, 'Run no encontrado');

    const detail = await getRunDetail(id);
    if (!detail) throw new HttpError(404, 'Run no encontrado');
    if (detail.run.agentId !== actor.agentId) {
      throw new HttpError(403, 'Este run no es de este agente');
    }

    return json(detail);
  });
}

/**
 * PATCH /api/v1/runs/:id
 *
 * Closes a run with `succeeded`, `failed` or `cancelled`. The timings and the
 * duration are stamped by the server; if the run belongs to a delegation, the
 * delegation is closed along with it.
 */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:write');
    const id = requireUuid((await params).id, 'Run no encontrado');

    const detail = await getRunDetail(id);
    if (!detail) throw new HttpError(404, 'Run no encontrado');
    if (detail.run.agentId !== actor.agentId) {
      throw new HttpError(403, 'Este run no es de este agente');
    }

    const input = await parseJson(request, runUpdateSchema);
    const run = await updateRun(id, input);
    if (!run) throw new HttpError(404, 'Run no encontrado');

    if (input.status && input.status !== detail.run.status) {
      await logActivity({
        actor: agentActivityActor(actor),
        action: `run.${input.status}`,
        entityType: 'run',
        entityId: id,
        meta: {
          from: detail.run.status,
          to: run.status,
          durationMs: run.durationMs,
          taskId: run.taskId,
          via: 'api',
        },
      });
    }

    return json({ run });
  });
}
