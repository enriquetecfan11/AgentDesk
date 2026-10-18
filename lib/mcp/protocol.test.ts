import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROTOCOL_VERSION,
  JSON_RPC,
  errorResult,
  handleIncoming,
  handleMessage,
  textResult,
  type McpHandlers,
} from '@/lib/mcp/protocol';

function handlers(overrides: Partial<McpHandlers> = {}): McpHandlers {
  return {
    instructions: 'instrucciones',
    listTools: () => [{ name: 'get_task', description: 'una tarea', inputSchema: { type: 'object' } }],
    callTool: async (name) => textResult({ called: name }),
    ...overrides,
  };
}

describe('handleMessage', () => {
  it('negotiates a version it knows, and falls back to the default', async () => {
    const asked = await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      handlers(),
    );
    expect(asked).toMatchObject({ result: { protocolVersion: '2024-11-05' } });

    const unknown = await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      handlers(),
    );
    expect(unknown).toMatchObject({ result: { protocolVersion: DEFAULT_PROTOCOL_VERSION } });
  });

  it('says nothing at all to a notification', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, handlers())).toBeNull();
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled' }, handlers())).toBeNull();
    // Even a malformed one: a notification has no id to answer to.
    expect(await handleMessage({ jsonrpc: '2.0' }, handlers())).toBeNull();
  });

  it('answers ping and tools/list', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' }, handlers())).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {},
    });

    const list = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, handlers());
    expect(list).toMatchObject({ result: { tools: [{ name: 'get_task' }] } });
  });

  it('rejects an unknown method with -32601', async () => {
    const response = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, handlers());
    expect(response).toMatchObject({ error: { code: JSON_RPC.methodNotFound } });
  });

  it('rejects a tools/call with no name with -32602', async () => {
    const response = await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} },
      handlers(),
    );
    expect(response).toMatchObject({ error: { code: JSON_RPC.invalidParams } });
  });

  it('treats a missing arguments object as an empty one', async () => {
    let seen: unknown = 'no llamada';
    await handleMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_task' } },
      handlers({
        callTool: async (_name, args) => {
          seen = args;
          return textResult('ok');
        },
      }),
    );
    expect(seen).toEqual({});
  });

  it('turns a tool that throws into a result, never into a protocol error', async () => {
    const response = await handleMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'boom' } },
      handlers({
        callTool: async () => {
          throw new Error('el token no tiene el scope tasks:write');
        },
      }),
    );

    // The session survives: a successful envelope carrying isError.
    expect(response).toHaveProperty('result');
    expect(response).toMatchObject({
      result: { isError: true, content: [{ type: 'text', text: 'el token no tiene el scope tasks:write' }] },
    });
  });

  it('rejects something that is not a JSON-RPC object', async () => {
    expect(await handleMessage('hola', handlers())).toMatchObject({
      error: { code: JSON_RPC.invalidRequest },
    });
    expect(await handleMessage(null, handlers())).toMatchObject({
      error: { code: JSON_RPC.invalidRequest },
    });
  });
});

describe('handleIncoming', () => {
  it('answers a batch in order and drops the notifications', async () => {
    const responses = await handleIncoming(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
      handlers(),
    );

    expect(responses).toHaveLength(2);
    expect(responses.map((response) => response.id)).toEqual([1, 2]);
  });

  it('returns nothing for a batch of pure notifications, so the transport can 202', async () => {
    const responses = await handleIncoming(
      [{ jsonrpc: '2.0', method: 'notifications/initialized' }],
      handlers(),
    );
    expect(responses).toEqual([]);
  });

  it('rejects an empty batch', async () => {
    const responses = await handleIncoming([], handlers());
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ error: { code: JSON_RPC.invalidRequest } });
  });
});

describe('result helpers', () => {
  it('renders an object as pretty JSON and a string as itself', () => {
    expect(textResult('hola')).toEqual({ content: [{ type: 'text', text: 'hola' }] });
    expect(textResult({ a: 1 }).content[0].text).toBe('{\n  "a": 1\n}');
  });

  it('flags an error result', () => {
    expect(errorResult('no')).toEqual({ content: [{ type: 'text', text: 'no' }], isError: true });
  });
});
