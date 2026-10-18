import { json, parseJson, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { createProject, listProjects } from '@/lib/domain/projects';
import { projectCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/projects */
export async function GET(request: Request) {
  return route(async () => {
    await requireAgent(request, 'projects:read');

    const includeArchived = new URL(request.url).searchParams.get('archived') === 'true';
    return json({ projects: await listProjects({ includeArchived }) });
  });
}

/** POST /api/v1/projects */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'projects:write');
    const input = await parseJson(request, projectCreateSchema);

    const project = await createProject(input);

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'project.created',
      entityType: 'project',
      entityId: project.id,
      meta: { name: project.name, via: 'api' },
    });

    return json({ project }, { status: 201 });
  });
}
