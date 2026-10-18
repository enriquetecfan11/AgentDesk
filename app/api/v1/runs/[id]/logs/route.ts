import { requireAgent } from '@/lib/auth/agent';
import { HttpError, json, parseJson, readJson, requireUuid, route } from '@/lib/api/http';
import { listRunLogs, appendRunLogs, getRun } from '@/lib/domain/runs';
import { runLogBatchSchema, runLogCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/runs/:id/logs?since=<ISO>
 *
 * `since` is what a reconnecting agent (or a browser that missed a few events)
 * uses to catch up without downloading the whole log again.
 */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:read');
    const id = requireUuid((await params).id, 'Run no encontrado');

    const detail = await getRun(id);
    if (!detail) throw new HttpError(404, 'Run no encontrado');
    if (detail.agentId !== actor.agentId) {
      throw new HttpError(403, 'Este run no es de este agente');
    }

    const since = new URL(request.url).searchParams.get('since');
    const sinceDate = since ? new Date(since) : undefined;

    return json({
      logs: await listRunLogs(id, {
        since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined,
      }),
    });
  });
}

/**
 * POST /api/v1/runs/:id/logs
 *
 * Accepts either a single line (`{ level, message }`) or a batch
 * (`{ logs: [...] }`): an agent usually has several lines to report at once and
 * should not have to make one request per line.
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

    const raw = await readJson(request);

    const batch = runLogBatchSchema.safeParse(raw);
    if (batch.success) {
      return json({ logs: await appendRunLogs(id, batch.data.logs) }, { status: 201 });
    }

    const single = runLogCreateSchema.safeParse(raw);
    if (!single.success) {
      throw new HttpError(422, 'Datos inválidos', single.error.issues);
    }

    return json({ logs: await appendRunLogs(id, [single.data]) }, { status: 201 });
  });
}
