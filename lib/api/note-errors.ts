import 'server-only';

import { HttpError } from '@/lib/api/http';
import {
  DuplicateNoteTitleError,
  NoteConflictError,
  NoteNotFoundError,
  NoteTooLargeError,
} from '@/lib/domain/notes';

/**
 * Translates the note domain errors into HTTP ones.
 *
 * The domain deliberately does not know about status codes; both the human and
 * the agent routes need exactly the same mapping, so it lives here once.
 */
export function mapNoteError(error: unknown): never {
  if (error instanceof DuplicateNoteTitleError) throw new HttpError(409, error.message);
  if (error instanceof NoteConflictError) throw new HttpError(409, error.message);
  if (error instanceof NoteNotFoundError) throw new HttpError(404, error.message);
  if (error instanceof NoteTooLargeError) throw new HttpError(422, error.message);

  throw error;
}
