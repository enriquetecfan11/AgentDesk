import 'server-only';

import type { AgentActor } from '@/lib/auth/agent';
import { FLOW_TOOLS } from '@/lib/mcp/tools-flow';
import { WORKSPACE_TOOLS } from '@/lib/mcp/tools-workspace';
import {
  errorResult,
  textResult,
  type McpHandlers,
  type ToolDescriptor,
  type ToolResult,
} from '@/lib/mcp/protocol';
import { requireScope, ToolError, type ToolDefinition } from '@/lib/mcp/shared';

/**
 * The tool catalogue, in one place.
 *
 * `FLOW_TOOLS` wins a name collision on purpose: `list_tasks` and `get_task`
 * exist in both lists and the flow versions are strict supersets — they return
 * the autonomy, the lease and the approvals as well. One table, so the stdio
 * bridge and the HTTP route can never drift apart.
 */
const ALL_TOOLS: ToolDefinition[] = (() => {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of WORKSPACE_TOOLS) byName.set(tool.name, tool);
  for (const tool of FLOW_TOOLS) byName.set(tool.name, tool);
  return [...byName.values()];
})();

const INSTRUCTIONS = [
  'AgentDesk es el espacio de trabajo de una persona y sus agentes. Tú trabajas para ella.',
  '',
  'El circuito: get_next_task reclama una tarea con un lease → append_log cuenta lo que haces',
  '(y renueva el lease) → propone con propose_delegation o request_approval → complete_task',
  'o fail_task la cierra.',
  '',
  'Nada con consecuencias se ejecuta sin que una persona lo apruebe en la web. Cuando una',
  'herramienta devuelve status="pending_approval" no ha pasado nada: consulta get_task para leer',
  'la decisión en el campo approvals. Si decision es "approved", usa payloadEdited si viene (la',
  'persona cambió tus argumentos). Si es "rejected", lee reason y cambia de plan: no lo reintentes',
  'igual. Una aprobación caducada llega como "rejected".',
  '',
  'El lease caduca. Si dejas de llamar, la tarea vuelve a la cola y la puede coger otro.',
].join('\n');

export function listToolDescriptors(): ToolDescriptor[] {
  return ALL_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export function toolNames(): string[] {
  return ALL_TOOLS.map((tool) => tool.name);
}

/**
 * Runs one tool for one agent.
 *
 * Every failure a caller can cause — a missing scope, a task that is not
 * there, arguments that do not parse — comes back as `isError: true` text
 * rather than as a JSON-RPC error. The model can read it and try something
 * else; a protocol error would just end the session. An unexpected throw is
 * logged on the server and reported without its internals.
 */
export async function callTool(
  actor: AgentActor,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    return errorResult(`No existe la herramienta «${name}». Usa tools/list para ver el catálogo.`);
  }

  try {
    requireScope(actor, tool.scope);
    return textResult(await tool.run({ actor }, args as never));
  } catch (error) {
    if (error instanceof ToolError) return errorResult(error.message);

    console.error(`[mcp] ${name} falló`, error);
    return errorResult('Error interno al ejecutar la herramienta');
  }
}

export function handlersFor(actor: AgentActor): McpHandlers {
  return {
    instructions: INSTRUCTIONS,
    listTools: listToolDescriptors,
    callTool: (name, args) => callTool(actor, name, args),
  };
}

export { INSTRUCTIONS };
