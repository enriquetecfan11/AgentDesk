/**
 * Agent credentials: format and scopes.
 *
 * Kept free of `server-only`, of Node built-ins and of the database so the
 * rules can be unit tested and reused by the UI to render the scope picker.
 * The pieces that touch crypto or Postgres live in `lib/auth/agent.ts`.
 *
 * A token looks like `agt_` followed by 43 base64url characters (256 bits).
 * Only its SHA-256 is stored, so a database dump cannot be replayed.
 */

export const AGENT_TOKEN_PREFIX = 'agt_';

/** Characters kept for display: `agt_1a2b3c4d`. */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12;

export const AGENT_SCOPES = [
  'tasks:read',
  'tasks:write',
  'notes:read',
  'notes:write',
  'projects:read',
  'projects:write',
  'delegations:read',
  'delegations:write',
  'runs:read',
  'runs:write',
  'activity:read',
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

/**
 * Groups are only a convenience for the UI: the token always stores the
 * explicit list of scopes it was granted.
 */
export const SCOPE_GROUPS: { area: string; label: string; scopes: AgentScope[] }[] = [
  { area: 'tasks', label: 'Tareas', scopes: ['tasks:read', 'tasks:write'] },
  { area: 'notes', label: 'Notas', scopes: ['notes:read', 'notes:write'] },
  { area: 'projects', label: 'Proyectos', scopes: ['projects:read', 'projects:write'] },
  { area: 'delegations', label: 'Delegaciones', scopes: ['delegations:read', 'delegations:write'] },
  { area: 'runs', label: 'Runs', scopes: ['runs:read', 'runs:write'] },
  { area: 'activity', label: 'Actividad', scopes: ['activity:read'] },
];

export const SCOPE_LABELS: Record<AgentScope, string> = {
  'tasks:read': 'Leer tareas',
  'tasks:write': 'Crear y modificar tareas',
  'notes:read': 'Leer notas',
  'notes:write': 'Escribir notas',
  'projects:read': 'Leer proyectos',
  'projects:write': 'Escribir proyectos',
  'delegations:read': 'Leer delegaciones',
  'delegations:write': 'Aceptar y completar delegaciones',
  'runs:read': 'Leer runs',
  'runs:write': 'Crear runs, logs y artefactos',
  'activity:read': 'Leer la actividad',
};

/** Everything, offered as a single click when creating a token. */
export const FULL_ACCESS_SCOPES: AgentScope[] = [...AGENT_SCOPES];

export function isAgentScope(value: string): value is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(value);
}

/**
 * `tasks:write` grants `tasks:read`.
 *
 * Writing without being able to read back what you wrote is never what the
 * caller meant, and forcing both checkboxes only invites a broken token.
 */
export function hasScope(granted: readonly string[], required: AgentScope): boolean {
  if (granted.includes('*') || granted.includes(required)) return true;
  if (required.endsWith(':read')) {
    return granted.includes(`${required.slice(0, -':read'.length)}:write`);
  }
  return false;
}

export function scopeLabel(scope: string): string {
  return isAgentScope(scope) ? SCOPE_LABELS[scope] : scope;
}

/** Reads the token out of an `Authorization` header. */
export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** First characters of a raw token, for the list in the UI. */
export function tokenDisplayPrefix(raw: string): string {
  return raw.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH);
}

/** Cheap shape check before hitting the database. */
export function looksLikeAgentToken(value: string): boolean {
  return /^agt_[A-Za-z0-9_-]{20,}$/.test(value);
}
