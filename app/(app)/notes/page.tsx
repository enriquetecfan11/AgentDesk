import { NotesWorkspace } from '@/components/notes/notes-workspace';
import { listNotes } from '@/lib/domain/notes';
import { listProjects } from '@/lib/domain/projects';

export const dynamic = 'force-dynamic';

/**
 * Notas: markdown con enlaces `[[entre notas]]` y backlinks.
 *
 * El listado se carga completo en el servidor (son notas personales, no miles)
 * para que la búsqueda del panel y la resolución de enlaces sean instantáneas.
 */
export default async function NotesPage() {
  const [notes, projects] = await Promise.all([listNotes(), listProjects()]);

  return (
    <div className="h-full">
      <NotesWorkspace initialNotes={notes} projects={projects} />
    </div>
  );
}
