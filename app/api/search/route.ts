import { json, requireApiUser, route } from '@/lib/api/http';
import { listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=…
 *
 * Backs the command palette. Two characters minimum: below that every task in
 * the workspace would match and the list would be useless.
 */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();

    const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (query.length < 2) return json({ tasks: [], projects: [] });

    const needle = query.toLowerCase();
    const [tasks, projects] = await Promise.all([listTasks({ search: query, limit: 8 }), listProjects()]);

    return json({
      tasks,
      projects: projects
        .filter(
          (project) =>
            project.name.toLowerCase().includes(needle) ||
            (project.identifier ?? '').toLowerCase().includes(needle),
        )
        .slice(0, 5),
    });
  });
}
