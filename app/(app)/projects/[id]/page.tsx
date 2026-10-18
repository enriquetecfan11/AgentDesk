import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProjectWorkspace } from '@/components/projects/project-workspace';
import { requireUser } from '@/lib/auth/session';
import { listLabels } from '@/lib/domain/labels';
import { getProject, listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  const [tasks, projects, labels] = await Promise.all([
    listTasks({ projectId: id, rootOnly: true, orderBy: 'manual' }),
    listProjects(),
    listLabels(),
  ]);

  return (
    <div className="flex h-full flex-col">
      <nav className="shrink-0 border-b border-border px-4 py-2 text-xs md:px-5" aria-label="Migas de pan">
        <Link
          href="/projects"
          className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Proyectos
        </Link>
        <span className="mx-1.5 text-muted-foreground">/</span>
        <span className="truncate">{project.name}</span>
      </nav>

      <div className="min-h-0 flex-1">
        <ProjectWorkspace
          project={project}
          initialTasks={tasks}
          projects={projects}
          labels={labels}
        />
      </div>
    </div>
  );
}
