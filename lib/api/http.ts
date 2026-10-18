import 'server-only';

import { ZodError, z, type ZodType } from 'zod';

import { getSessionUser, type SessionUser } from '@/lib/auth/session';

/** Error with a status code that is safe to surface to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' }, ...init });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición no es JSON válido');
  }
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const body = await readJson(request);

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(422, 'Datos inválidos', result.error.issues);
  }
  return result.data;
}

/** Wraps a handler so domain errors become clean JSON instead of stack traces. */
export async function route(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json(
        { error: error.message, details: error.details ?? null },
        { status: error.status },
      );
    }
    if (error instanceof ZodError) {
      return Response.json(
        { error: 'Datos inválidos', details: error.issues },
        { status: 422 },
      );
    }
    console.error('[api] error no controlado', error);
    return Response.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

/** Throws 401 instead of redirecting — for Route Handlers. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'No autenticado');
  return user;
}

/**
 * Validates a path parameter.
 *
 * Without this, a malformed id reaches Postgres and the driver raises an
 * "invalid input syntax for type uuid" error — a 500 for what is really a
 * missing resource.
 */
export function requireUuid(value: string, message = 'Recurso no encontrado'): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(404, message);
  return parsed.data;
}
