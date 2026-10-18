import { ProjectsView } from '@/components/projects/projects-view';
import { requireUser } from '@/lib/auth/session';
import { listProjects } from '@/lib/domain/projects';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  await requireUser();
  const projects = await listProjects();

  return <ProjectsView initialProjects={projects} />;
}
