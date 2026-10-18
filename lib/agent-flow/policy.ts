/**
 * What an agent may do by itself, and what has to wait for a person.
 *
 * Two inputs, one answer: the tool being called (which carries a fixed risk)
 * and the autonomy of the task it is being called on. Kept free of
 * `server-only`, of the database and of Node built-ins so the rules can be
 * unit tested and reused by the UI to paint the risk badge — the same reason
 * `lib/agent-token.ts` is split from `lib/auth/agent.ts`.
 *
 * The rule the whole thing exists to enforce: reading and commenting are free,
 * subtasks get a notice, and delegating, executing, sending or deleting always
 * stop for approval.
 */
import type { AgentScope } from '@/lib/agent-token';
import type { RiskLevelValue, TaskAutonomyValue } from '@/lib/constants';

export const MCP_TOOLS = [
  'list_tasks',
  'get_next_task',
  'get_task',
  'claim_task',
  'update_task_status',
  'add_comment',
  'append_log',
  'attach_artifact',
  'create_subtask',
  'propose_delegation',
  'request_approval',
  'complete_task',
  'fail_task',
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

export type ToolPolicy = {
  risk: RiskLevelValue;
  /**
   * Whether the call changes the work itself.
   *
   * Commenting, logging and attaching are `false`: they narrate what happened
   * without moving anything, which is why they stay free even under
   * `suggest_only`.
   */
  mutates: boolean;
  /** One of the scopes that already exist. No new scope was added for this. */
  scope: AgentScope;
};

export const TOOL_POLICY: Record<McpToolName, ToolPolicy> = {
  list_tasks: { risk: 'low', mutates: false, scope: 'tasks:read' },
  get_task: { risk: 'low', mutates: false, scope: 'tasks:read' },
  add_comment: { risk: 'low', mutates: false, scope: 'tasks:write' },
  append_log: { risk: 'low', mutates: false, scope: 'runs:write' },
  attach_artifact: { risk: 'low', mutates: false, scope: 'runs:write' },

  get_next_task: { risk: 'low', mutates: true, scope: 'tasks:write' },
  claim_task: { risk: 'low', mutates: true, scope: 'tasks:write' },
  update_task_status: { risk: 'low', mutates: true, scope: 'tasks:write' },
  complete_task: { risk: 'low', mutates: true, scope: 'tasks:write' },
  fail_task: { risk: 'low', mutates: true, scope: 'tasks:write' },

  create_subtask: { risk: 'medium', mutates: true, scope: 'tasks:write' },

  propose_delegation: { risk: 'high', mutates: true, scope: 'delegations:write' },
  request_approval: { risk: 'high', mutates: true, scope: 'tasks:write' },
};

export type GateEffect =
  /** Runs now. */
  | 'allow'
  /** Runs now, but is flagged in the activity log and listed as a notice. */
  | 'notice'
  /** Does not run. An approval row is created and the agent is told to poll. */
  | 'needs_approval';

export type GateDecision = {
  effect: GateEffect;
  risk: RiskLevelValue;
  /** Why, in Spanish, ready to hand to the agent as text. */
  reason: string;
};

export function isMcpTool(value: string): value is McpToolName {
  return (MCP_TOOLS as readonly string[]).includes(value);
}

export function toolRisk(tool: string): RiskLevelValue {
  // An unknown tool is treated as the most dangerous thing it could be.
  return isMcpTool(tool) ? TOOL_POLICY[tool].risk : 'high';
}

/**
 * The gate.
 *
 * | riesgo          | suggest_only    | do_with_approval | autonomous_low_risk |
 * |-----------------|-----------------|------------------|---------------------|
 * | low, no mutante | allow           | allow            | allow               |
 * | low, mutante    | needs_approval  | allow            | allow               |
 * | medium          | needs_approval  | notice           | allow               |
 * | high            | needs_approval  | needs_approval   | needs_approval      |
 *
 * `high` never clears on its own, whatever the autonomy says: that column is
 * about how much bookkeeping you want to do, not about handing over the
 * authority to delegate work or to touch something outside AgentDesk.
 */
export function gate(tool: string, autonomy: TaskAutonomyValue): GateDecision {
  if (!isMcpTool(tool)) {
    return {
      effect: 'needs_approval',
      risk: 'high',
      reason: `La herramienta «${tool}» no está en el catálogo: se pide aprobación por defecto`,
    };
  }

  const policy = TOOL_POLICY[tool];

  if (policy.risk === 'high') {
    return {
      effect: 'needs_approval',
      risk: 'high',
      reason: 'Delegar, ejecutar, enviar o borrar siempre necesita aprobación',
    };
  }

  if (policy.risk === 'medium') {
    if (autonomy === 'suggest_only') {
      return {
        effect: 'needs_approval',
        risk: 'medium',
        reason: 'La tarea está en «solo propone»: cualquier cambio pasa por una persona',
      };
    }
    if (autonomy === 'do_with_approval') {
      return { effect: 'notice', risk: 'medium', reason: 'Queda un aviso en la actividad' };
    }
    return { effect: 'allow', risk: 'medium', reason: 'Riesgo medio y tarea autónoma' };
  }

  if (!policy.mutates) {
    return { effect: 'allow', risk: 'low', reason: 'Leer, comentar y adjuntar son libres' };
  }

  if (autonomy === 'suggest_only') {
    return {
      effect: 'needs_approval',
      risk: 'low',
      reason: 'La tarea está en «solo propone»: el agente no cambia su estado',
    };
  }

  return { effect: 'allow', risk: 'low', reason: 'Riesgo bajo y la tarea lo permite' };
}
