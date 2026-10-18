import { describe, expect, it } from 'vitest';

import {
  MCP_TOOLS,
  TOOL_POLICY,
  gate,
  isMcpTool,
  toolRisk,
  type McpToolName,
} from '@/lib/agent-flow/policy';
import { TASK_AUTONOMIES, type TaskAutonomyValue } from '@/lib/constants';

const FREE_TOOLS: McpToolName[] = [
  'list_tasks',
  'get_task',
  'add_comment',
  'append_log',
  'attach_artifact',
];

const ALWAYS_APPROVED: McpToolName[] = ['propose_delegation', 'request_approval'];

describe('gate', () => {
  it('lets reading, commenting and attaching through under every autonomy', () => {
    for (const tool of FREE_TOOLS) {
      for (const autonomy of TASK_AUTONOMIES) {
        expect(gate(tool, autonomy).effect, `${tool}/${autonomy}`).toBe('allow');
      }
    }
  });

  it('never clears delegating or executing, however autonomous the task is', () => {
    for (const tool of ALWAYS_APPROVED) {
      for (const autonomy of TASK_AUTONOMIES) {
        expect(gate(tool, autonomy).effect, `${tool}/${autonomy}`).toBe('needs_approval');
      }
    }
  });

  it('holds back low-risk writes only under suggest_only', () => {
    expect(gate('update_task_status', 'suggest_only').effect).toBe('needs_approval');
    expect(gate('complete_task', 'suggest_only').effect).toBe('needs_approval');
    expect(gate('claim_task', 'suggest_only').effect).toBe('needs_approval');

    expect(gate('update_task_status', 'do_with_approval').effect).toBe('allow');
    expect(gate('complete_task', 'autonomous_low_risk').effect).toBe('allow');
  });

  it('walks a subtask through the three autonomies: approval, notice, silence', () => {
    expect(gate('create_subtask', 'suggest_only').effect).toBe('needs_approval');
    expect(gate('create_subtask', 'do_with_approval').effect).toBe('notice');
    expect(gate('create_subtask', 'autonomous_low_risk').effect).toBe('allow');
  });

  it('fails closed on a tool it has never heard of', () => {
    for (const autonomy of TASK_AUTONOMIES) {
      const decision = gate('rm_minus_rf', autonomy);
      expect(decision.effect).toBe('needs_approval');
      expect(decision.risk).toBe('high');
    }
    expect(toolRisk('rm_minus_rf')).toBe('high');
    expect(isMcpTool('rm_minus_rf')).toBe(false);
  });

  it('answers for every tool and every autonomy, with a reason attached', () => {
    const autonomies: TaskAutonomyValue[] = [...TASK_AUTONOMIES];
    for (const tool of MCP_TOOLS) {
      for (const autonomy of autonomies) {
        const decision = gate(tool, autonomy);
        expect(['allow', 'notice', 'needs_approval']).toContain(decision.effect);
        expect(decision.risk).toBe(TOOL_POLICY[tool].risk);
        expect(decision.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every tool a scope that already exists', () => {
    for (const tool of MCP_TOOLS) {
      expect(TOOL_POLICY[tool].scope).toMatch(/^(tasks|notes|projects|delegations|runs|activity):/);
    }
  });
});
