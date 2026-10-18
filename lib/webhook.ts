/**
 * Outgoing webhooks: the event catalogue and the subscription rules.
 *
 * This module is deliberately free of Node built-ins and of `server-only`: the
 * settings UI renders the event picker from the same list the server validates
 * against, so a new event only has to be declared once. The parts that need
 * crypto live in `lib/webhook-signature.ts`.
 */

export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/** `whsec_1a2b3c4d…` — enough to recognise a secret, not enough to use it. */
export function webhookSecretPreview(secret: string): string {
  return `${secret.slice(0, 12)}…`;
}

/**
 * Header names. HTTP header names are case-insensitive, so they are written in
 * lower case and read back the same way.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-agentdesk-signature';
export const WEBHOOK_EVENT_HEADER = 'x-agentdesk-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-agentdesk-delivery';
export const WEBHOOK_USER_AGENT = 'AgentDesk-Webhooks/1.0';

export type WebhookEventDefinition = {
  name: string;
  label: string;
  description: string;
  /**
   * Chatty or overlapping events. The UI still offers them, but not in the
   * "select everything" button: a subscriber that wants the summary should not
   * also get a line per log entry.
   */
  noisy?: boolean;
};

/** The vocabulary is the same one the SSE stream uses, so there is one list. */
export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
  {
    name: 'task.changed',
    label: 'Tareas',
    description: 'Una tarea se crea, se modifica o se borra.',
  },
  {
    name: 'task.comment',
    label: 'Comentarios',
    description: 'Una persona o un agente comenta en una tarea.',
  },
  {
    name: 'note.changed',
    label: 'Notas',
    description: 'Una nota se crea, se edita, se renombra o se borra.',
  },
  {
    name: 'delegation.updated',
    label: 'Delegaciones',
    description: 'Cambia el estado de una delegación.',
  },
  {
    name: 'approval.requested',
    label: 'Aprobaciones pedidas',
    description: 'Un agente pide permiso para algo y se queda esperando tu decisión.',
  },
  {
    name: 'approval.decided',
    label: 'Aprobaciones decididas',
    description: 'Una aprobación se aprueba, se rechaza, se cancela o caduca.',
  },
  {
    name: 'task.claimed',
    label: 'Tareas reclamadas',
    description: 'Un agente toma una tarea y abre su lease.',
  },
  {
    name: 'run.updated',
    label: 'Runs',
    description: 'Un run se abre o se cierra.',
  },
  {
    name: 'run.artifact',
    label: 'Artefactos',
    description: 'Un run adjunta un artefacto.',
  },
  {
    name: 'run.log',
    label: 'Logs de run',
    description: 'Cada línea de log de un run. Puede ser muy hablador.',
    noisy: true,
  },
  {
    name: 'activity',
    label: 'Actividad',
    description: 'Cada acción de la cronología. Se solapa con el resto de eventos.',
    noisy: true,
  },
];

export const WEBHOOK_EVENT_NAMES = WEBHOOK_EVENTS.map((event) => event.name);

/** Everything the "suscribir a todo" button picks. */
export const QUIET_WEBHOOK_EVENTS = WEBHOOK_EVENTS.filter((event) => !event.noisy).map(
  (event) => event.name,
);

export const WEBHOOK_EVENT_PREFIXES = ['task', 'note', 'delegation', 'run', 'activity'];

export function isWebhookEvent(value: string): boolean {
  return WEBHOOK_EVENT_NAMES.includes(value);
}

export function webhookEventLabel(name: string): string {
  return WEBHOOK_EVENTS.find((event) => event.name === name)?.label ?? name;
}

/**
 * A subscription is one of: the exact name, `*` for everything, or `area.*`
 * for a whole family (`task.*` covers `task.changed` and `task.comment`).
 */
export function isWebhookPattern(value: string): boolean {
  if (value === '*' || isWebhookEvent(value)) return true;

  const match = /^([a-z]+)\.\*$/.exec(value);
  return Boolean(match && WEBHOOK_EVENT_PREFIXES.includes(match[1]));
}

/**
 * Matching happens on the receiving end of the fan-out, in memory, over the
 * handful of configured webhooks: a subscription is a rule, not a database
 * query.
 */
export function matchesWebhookEvent(subscribed: readonly string[], event: string): boolean {
  return subscribed.some((pattern) => {
    if (pattern === '*' || pattern === event) return true;
    // "task.*" → "task." is a prefix of "task.changed".
    if (pattern.endsWith('.*')) return event.startsWith(pattern.slice(0, -1));
    return false;
  });
}
