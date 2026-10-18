/**
 * JSON-RPC 2.0 and the slice of MCP that AgentDesk speaks.
 *
 * Hand-rolled, like the stdio server this replaces: the protocol is four
 * methods and an envelope, and a dependency to spell that out would be a
 * dependency to audit on every `npm ci`. Kept free of the database, of
 * `server-only` and of Node built-ins so the envelope rules can be tested on
 * their own — which matters, because the rules are mostly about what *not* to
 * reply.
 *
 * The one rule worth stating out loud: **a tool that fails is not a protocol
 * error.** It comes back as a successful result carrying `isError: true`, so
 * the model reads "no pudiste" as text and can try something else, instead of
 * the client tearing down the session over a 403.
 */

export const SERVER_NAME = 'agentdesk';
export const SERVER_VERSION = '2.0.0';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

/** JSON-RPC error codes, the four we can actually produce. */
export const JSON_RPC = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = string | number | null;

export type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export type McpHandlers = {
  instructions: string;
  listTools: () => ToolDescriptor[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
};

export function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result: value };
}

export function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** Anything a tool returns, rendered as the text the model will read. */
export function textResult(value: unknown): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function negotiateVersion(params: unknown): string {
  const asked =
    typeof params === 'object' && params !== null
      ? (params as { protocolVersion?: unknown }).protocolVersion
      : undefined;

  return typeof asked === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
    ? asked
    : DEFAULT_PROTOCOL_VERSION;
}

function readToolCall(params: unknown): { name: string; args: Record<string, unknown> } | null {
  if (typeof params !== 'object' || params === null) return null;

  const { name, arguments: args } = params as { name?: unknown; arguments?: unknown };
  if (typeof name !== 'string' || name.length === 0) return null;

  return {
    name,
    args:
      typeof args === 'object' && args !== null && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {},
  };
}

/**
 * Handles one message.
 *
 * Returns `null` when there is nothing to reply: a notification (no `id`) gets
 * no response, ever. Sending one back is the classic way to make a strict
 * client hang up.
 */
export async function handleMessage(
  message: unknown,
  handlers: McpHandlers,
): Promise<JsonRpcResponse | null> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return failure(null, JSON_RPC.invalidRequest, 'El mensaje no es un objeto JSON-RPC');
  }

  const { id, method, params } = message as JsonRpcMessage;
  const isNotification = id === undefined;

  if (typeof method !== 'string') {
    return isNotification
      ? null
      : failure(id ?? null, JSON_RPC.invalidRequest, 'Falta el campo "method"');
  }

  // `notifications/initialized`, `notifications/cancelled` and anything else
  // the client announces: acknowledged by silence.
  if (isNotification) return null;

  const responseId = id ?? null;

  switch (method) {
    case 'initialize':
      return result(responseId, {
        protocolVersion: negotiateVersion(params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: handlers.instructions,
      });

    case 'ping':
      return result(responseId, {});

    case 'tools/list':
      return result(responseId, { tools: handlers.listTools() });

    case 'tools/call': {
      const call = readToolCall(params);
      if (!call) {
        return failure(responseId, JSON_RPC.invalidParams, 'Falta el nombre de la herramienta');
      }

      try {
        return result(responseId, await handlers.callTool(call.name, call.args));
      } catch (error) {
        // A thrown tool is still a tool result, not a dead session.
        const text = error instanceof Error ? error.message : 'Error interno de la herramienta';
        return result(responseId, errorResult(text));
      }
    }

    default:
      return failure(responseId, JSON_RPC.methodNotFound, `Método no soportado: ${method}`);
  }
}

/**
 * Handles a message or a batch of them.
 *
 * A batch where every entry is a notification produces no responses at all,
 * which the transport turns into a `202`.
 */
export async function handleIncoming(
  payload: unknown,
  handlers: McpHandlers,
): Promise<JsonRpcResponse[]> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return [failure(null, JSON_RPC.invalidRequest, 'El lote está vacío')];
    }

    const responses: JsonRpcResponse[] = [];
    for (const entry of payload) {
      const response = await handleMessage(entry, handlers);
      if (response) responses.push(response);
    }
    return responses;
  }

  const response = await handleMessage(payload, handlers);
  return response ? [response] : [];
}
