import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { createProject, listProjects } from '@/lib/domain/projects';
import { projectCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/projects */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';
    const projects = await listProjects({ includeArchived });
    return json({ projects });
  });
}

/** POST /api/projects */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, projectCreateSchema);

    const project = await createProject(input);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'project.created',
      entityType: 'project',
      entityId: project.id,
      meta: { name: project.name },
    });

    return json({ project }, { status: 201 });
  });
}
