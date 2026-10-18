import 'server-only';

import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getEnv } from '@/lib/env';

/**
 * Files an agent leaves behind.
 *
 * Everything lives under `UPLOADS_DIR`, which compose mounts as a named volume.
 * Only the relative path is stored in the database, so the data directory can
 * be moved (Mac mini → Proxmox) without rewriting rows.
 */

/** Strips anything that could escape the folder or upset a filesystem. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-]+/, '');

  return cleaned.length > 0 ? cleaned.slice(0, 160) : 'artefacto';
}

export function uploadsRoot(): string {
  return path.resolve(getEnv().UPLOADS_DIR);
}

/** Absolute path for a relative one, refusing anything outside the root. */
export function resolveUploadPath(relativePath: string): string {
  const root = uploadsRoot();
  const absolute = path.resolve(root, relativePath);

  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error(`Ruta fuera del directorio de subidas: ${relativePath}`);
  }

  return absolute;
}

export async function saveUpload(relativePath: string, data: Buffer): Promise<void> {
  const absolute = resolveUploadPath(relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, data);
}

export async function readUpload(relativePath: string): Promise<Buffer> {
  return readFile(resolveUploadPath(relativePath));
}

/**
 * Best-effort removal. A missing file is not an error: the row that pointed at
 * it is what matters, and the volume may have been restored from a backup.
 */
export async function removeUpload(relativePath: string): Promise<void> {
  try {
    await rm(resolveUploadPath(relativePath), { force: true });
  } catch (error) {
    console.error('[storage] no se pudo borrar', relativePath, error);
  }
}

/**
 * Removes a directory only if it is empty: "artefactos/<run>" exists to group a
 * run's files, and leaving an empty folder behind for every deleted run would
 * grow the volume with nothing in it.
 */
export async function removeUploadDir(relativePath: string): Promise<void> {
  try {
    await rmdir(resolveUploadPath(relativePath));
  } catch {
    // No existía, o todavía tiene ficheros: las dos cosas son normales.
  }
}
