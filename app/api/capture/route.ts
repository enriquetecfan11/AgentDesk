import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { createTaskFromCapture } from '@/lib/domain/capture';
import { captureSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/capture
 *
 * One line of natural language in, one task out. This is the endpoint behind
 * the quick-capture box on Inbox, Hoy and Próximas.
 */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, captureSchema);

    const result = await createTaskFromCapture(input.text, { projectId: input.projectId ?? null });

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'task.captured',
      entityType: 'task',
      entityId: result.task.id,
      meta: {
        title: result.task.title,
        raw: input.text,
        understood: result.capture.hints,
        recurrence: result.capture.recurrence,
      },
    });

    return json(result, { status: 201 });
  });
}
