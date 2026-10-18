#!/usr/bin/env node
/**
 * Runner de referencia para cron.
 *
 * Una pasada por invocación: despierta, reclama una tarea, cuenta lo que hace,
 * propone lo que no puede hacer solo y se va. No es un demonio y no tiene
 * bucle propio: quien marca el ritmo es el cron, que es lo que permite ver qué
 * pasó en cada pasada leyendo el log del sistema.
 *
 * Habla MCP contra POST /api/mcp con el token del agente. Sin dependencias.
 *
 *   AGENTDESK_URL    http://192.168.1.50:3000   (obligatoria, sin barra final)
 *   AGENTDESK_TOKEN  agt_…                      (obligatoria)
 *
 * Opcionales, para que el reparto sea configurable sin tocar el código:
 *   AGENTDESK_RUNNER_DELEGATE_LABEL   etiqueta que significa "esto no es mío"
 *   AGENTDESK_RUNNER_DELEGATE_TO      uuid del agente a quien proponérsela
 *   AGENTDESK_RUNNER_PROJECT          limita la pasada a un proyecto
 *   AGENTDESK_RUNNER_TOOL             nombre de la acción que pide ejecutar
 *                                     (por defecto "task.execute")
 *
 * Opciones:
 *   --max=N   tareas por pasada (por defecto 1)
 *   --dry     reclama y lee, pero no propone, ni comenta, ni cierra: enseña
 *             qué haría. Reclamar sí se hace, porque sin lease no hay nada que
 *             enseñar.
 *
 * En el cron del host, cada cinco minutos (la línea entera está en
 * docs/operacion.md, porque un "asterisco barra cinco" no se puede escribir
 * dentro de un comentario de bloque sin cerrarlo):
 *
 *   node /ruta/agent-os/scripts/task-runner.mjs
 *
 * Dos pasadas simultáneas no se pisan: get_next_task reclama con un lease y
 * `for update skip locked`, así que cada una se lleva una tarea distinta —
 * nunca la misma dos veces. Y un solo run por tarea, porque append_log
 * reutiliza el run abierto en lugar de abrir otro.
 */
const BASE_URL = (process.env.AGENTDESK_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.AGENTDESK_TOKEN ?? '';
const ENDPOINT = `${BASE_URL}/api/mcp`;

const DELEGATE_LABEL = process.env.AGENTDESK_RUNNER_DELEGATE_LABEL ?? '';
const DELEGATE_TO = process.env.AGENTDESK_RUNNER_DELEGATE_TO ?? '';
const PROJECT_ID = process.env.AGENTDESK_RUNNER_PROJECT ?? '';
const EXECUTE_TOOL = process.env.AGENTDESK_RUNNER_TOOL ?? 'task.execute';

const DRY = process.argv.includes('--dry');
const MAX = (() => {
  const flag = process.argv.find((arg) => arg.startsWith('--max='));
  const value = flag ? Number(flag.slice('--max='.length)) : 1;
  return Number.isFinite(value) && value >= 1 ? Math.min(value, 20) : 1;
})();

let nextId = 1;

function log(...parts) {
  process.stdout.write(`${new Date().toISOString()} ${parts.join(' ')}\n`);
}

// ---------------------------------------------------------------------------
// Cliente MCP
// ---------------------------------------------------------------------------

async function rpc(method, params) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${method} → HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text);
  if (payload.error) throw new Error(`${method} → ${payload.error.message}`);

  return payload.result;
}

/**
 * Llama a una herramienta y devuelve su resultado ya parseado.
 *
 * El protocolo no distingue "no pudiste" de "no existe": un fallo de la
 * herramienta llega como un resultado con isError, que aquí se convierte en
 * una excepción para que la pasada no siga como si nada.
 */
/**
 * Lo que `--dry` no ejecuta.
 *
 * La lista va por nombre y no por prefijo: `whoami` y `get_queue` solo leen
 * aunque no empiecen por `list_`, y `get_next_task` escribe aunque empiece por
 * `get_`. Adivinarlo por el nombre es justo el error que deja una pasada en
 * seco intentando leer un resultado que nunca pidió.
 */
const DRY_SKIP = new Set([
  'append_log',
  'add_comment',
  'create_subtask',
  'propose_delegation',
  'request_approval',
  'complete_task',
  'fail_task',
  'update_task_status',
  'attach_artifact',
]);

async function call(tool, args = {}) {
  if (DRY && DRY_SKIP.has(tool)) {
    log(`  [dry] ${tool}`, JSON.stringify(args));
    return null;
  }

  const result = await rpc('tools/call', { name: tool, arguments: args });
  const text = result?.content?.[0]?.text ?? '';

  if (result?.isError) throw new Error(`${tool}: ${text}`);

  try {
    return text.length > 0 ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// El cerebro
// ---------------------------------------------------------------------------

/**
 * Qué hacer con una tarea.
 *
 * Aquí es donde va tu lógica —un modelo, un árbol de reglas, lo que sea—. Lo
 * que viene de serie son dos reglas deliberadamente tontas, suficientes para
 * ver el circuito completo funcionando:
 *
 *   1. Si la tarea lleva la etiqueta de AGENTDESK_RUNNER_DELEGATE_LABEL,
 *      proponer pasársela al agente de AGENTDESK_RUNNER_DELEGATE_TO.
 *   2. Si no, pedir permiso para ejecutarla.
 *
 * Las dos acaban en una aprobación, que es el punto: este runner no decide
 * nada irreversible por su cuenta.
 */
function decide(task) {
  if (DELEGATE_LABEL && DELEGATE_TO && (task.labels ?? []).includes(DELEGATE_LABEL)) {
    return {
      kind: 'delegate',
      toAgentId: DELEGATE_TO,
      reason: `lleva la etiqueta «${DELEGATE_LABEL}»`,
    };
  }

  return {
    kind: 'execute',
    tool: EXECUTE_TOOL,
    reason: 'no hay nadie mejor a quien pasársela',
    payload: { taskId: task.id, title: task.title, description: task.description ?? null },
  };
}

/**
 * Lo que de verdad hace el trabajo, una vez aprobado.
 *
 * El esqueleto no ejecuta nada: devuelve lo que haría. Sustitúyelo por tu
 * integración y respeta el contrato — recibe los argumentos **aprobados**
 * (`payloadEdited` si la persona los cambió, los originales si no) y devuelve
 * un texto para el output del run.
 */
async function execute(approvedPayload) {
  return `Nada que ejecutar: este runner es una referencia. Argumentos aprobados: ${JSON.stringify(approvedPayload)}`;
}

// ---------------------------------------------------------------------------
// Una tarea
// ---------------------------------------------------------------------------

/** La aprobación que este runner estaba esperando, si hay alguna. */
function pendingDecision(approvals) {
  const mine = approvals.filter(
    (approval) => approval.tool === 'propose_delegation' || approval.tool === EXECUTE_TOOL,
  );

  // La más reciente manda: si hay varias, la última decisión es la vigente.
  return mine[mine.length - 1] ?? null;
}

async function work(taskId) {
  const detail = await call('get_task', { taskId });
  const task = detail.task;

  log(`  «${task.title}» (${task.status}, autonomía ${task.autonomy})`);

  const approval = pendingDecision(detail.approvals ?? []);

  if (approval?.decision === 'pending') {
    log(`  esperando tu decisión sobre ${approval.tool}; no toco nada`);
    await call('append_log', {
      taskId,
      message: `Sigo esperando el visto bueno de «${approval.tool}».`,
    });
    return 'waiting';
  }

  if (approval?.decision === 'rejected') {
    log(`  rechazada: ${approval.reason ?? 'sin motivo'}`);
    // Un rechazo no se reintenta igual: eso es un bucle. Se deja por escrito y
    // la tarea pasa a revisión para que la mire una persona.
    await call('fail_task', {
      taskId,
      error: `Me dijiste que no a «${approval.tool}»: ${approval.reason ?? 'sin motivo'}`,
    });
    return 'rejected';
  }

  if (approval?.decision === 'approved') {
    const approved = approval.payloadEdited ?? approval.payload;
    log(`  aprobada «${approval.tool}»: ejecuto`);

    await call('append_log', { taskId, message: `Aprobado «${approval.tool}». Empiezo.` });
    const output = await execute(approved);
    await call('append_log', { taskId, message: output });
    await call('complete_task', { taskId, output });
    return 'completed';
  }

  // Primera vez que la veo: cuento qué pienso hacer y lo propongo.
  const plan = decide(task);
  await call('append_log', {
    taskId,
    message:
      plan.kind === 'delegate'
        ? `Creo que esto le toca a otro agente (${plan.reason}). Lo propongo.`
        : `Puedo hacerlo yo (${plan.reason}). Pido permiso.`,
  });

  if (plan.kind === 'delegate') {
    await call('propose_delegation', {
      taskId,
      toAgentId: plan.toAgentId,
      title: task.title,
      instructions: task.description ?? undefined,
      summary: `Propuesta automática del runner: ${plan.reason}.`,
    });
    log('  delegación propuesta; esperando tu decisión');
    return 'proposed';
  }

  await call('request_approval', {
    taskId,
    tool: plan.tool,
    title: `Ejecutar «${task.title}»`,
    summary: `Propuesta automática del runner: ${plan.reason}.`,
    payload: plan.payload,
    // Una pasada que reintenta tras un corte no debe abrir una segunda
    // petición idéntica: la clave devuelve la que ya existe.
    idempotencyKey: `runner:${plan.tool}:${taskId}`,
  });
  log('  permiso pedido; esperando tu decisión');
  return 'requested';
}

// ---------------------------------------------------------------------------
// Una pasada
// ---------------------------------------------------------------------------

async function attempt(taskId) {
  try {
    const outcome = await work(taskId);
    log(`  → ${outcome}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`  ✗ ${message}`);

    // Soltar la tarea con el motivo es mejor que dejarla con un lease que
    // nadie va a renovar: así la ve una persona en lugar de volver a la cola
    // dentro de quince minutos para que falle otra vez.
    try {
      await call('fail_task', { taskId, error: message });
    } catch {
      log('  ✗ y tampoco pude marcarla como fallida');
    }
  }
}

/**
 * Las tareas que este agente ya tiene en la mano.
 *
 * Hay que mirarlas **antes** de pedir trabajo nuevo, y por una razón que no se
 * ve hasta que pasa: `get_next_task` no devuelve una tarea con un lease vivo,
 * ni siquiera al agente que lo tiene. Así que un runner que solo pidiera
 * trabajo nuevo aparcaría una petición y luego no podría volver a la tarea
 * para leer tu respuesta hasta que su propio lease caducara —quince minutos de
 * espera por nada—.
 */
async function held(agentId) {
  const listed = await call('list_tasks', {
    mine: true,
    status: 'backlog,todo,in_progress,review',
    limit: 50,
  });

  return (listed?.tasks ?? []).filter(
    (task) => task.claimedByAgentId === agentId && (task.leaseSecondsLeft ?? 0) > 0,
  );
}

async function main() {
  const missing = [];
  if (!BASE_URL) missing.push('AGENTDESK_URL');
  if (!TOKEN) missing.push('AGENTDESK_TOKEN');
  if (missing.length > 0) {
    process.stderr.write(`[task-runner] Falta ${missing.join(' y ')}.\n`);
    process.exit(1);
  }

  await rpc('initialize', { protocolVersion: '2025-06-18' });

  const me = await call('whoami');
  log(`pasada de «${me.agent.name}»${DRY ? ' (dry run)' : ''}`);

  let budget = MAX;

  for (const task of await held(me.agent.id)) {
    if (budget === 0) break;
    if (PROJECT_ID && task.projectId !== PROJECT_ID) continue;

    budget -= 1;
    log(`ya en mano ${task.id} · quedan ${task.leaseSecondsLeft}s de lease`);
    await attempt(task.id);
  }

  while (budget > 0) {
    const claim = await call('get_next_task', PROJECT_ID ? { projectId: PROJECT_ID } : {});

    if (!claim?.task) {
      if (budget === MAX) log('nada pendiente');
      break;
    }

    budget -= 1;
    log(`reclamada ${claim.task.id} · lease hasta ${claim.leaseExpiresAt}`);
    await attempt(claim.task.id);
  }
}

void main().catch((error) => {
  process.stderr.write(`[task-runner] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
