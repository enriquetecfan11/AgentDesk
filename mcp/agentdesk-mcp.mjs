#!/usr/bin/env node
/**
 * AgentDesk MCP — puente stdio.
 *
 * El servidor MCP vive en la aplicación, en `POST /api/mcp`: habla Streamable
 * HTTP y es donde están definidas las herramientas. Este fichero existe solo
 * para los clientes que todavía exigen lanzar un proceso hijo y hablarle por
 * stdin/stdout (Claude Desktop entre ellos).
 *
 * No traduce nada: lee un mensaje JSON-RPC de stdin, lo reenvía tal cual y
 * escribe la respuesta en stdout. Antes mantenía su propia tabla de 18
 * herramientas, que era una segunda fuente de verdad condenada a desviarse de
 * la de la aplicación; ahora `tools/list` lo contesta el servidor y aquí no
 * hay catálogo que envejezca.
 *
 * Sin dependencias: se copia a la máquina del agente y se ejecuta con node.
 *
 *   AGENTDESK_URL    http://192.168.1.50:3000     (sin barra final)
 *   AGENTDESK_TOKEN  agt_…                        (token del agente)
 *
 * Configuración en un cliente que lance un proceso (claude_desktop_config.json):
 *
 *   {
 *     "mcpServers": {
 *       "agentdesk": {
 *         "command": "node",
 *         "args": ["/ruta/a/agentdesk-mcp.mjs"],
 *         "env": {
 *           "AGENTDESK_URL": "http://192.168.1.50:3000",
 *           "AGENTDESK_TOKEN": "agt_..."
 *         }
 *       }
 *     }
 *   }
 *
 * Si el cliente habla Streamable HTTP, no necesitas este fichero: apúntalo a
 * http://192.168.1.50:3000/api/mcp con la cabecera Authorization.
 *
 * Nada se escribe en stdout que no sea JSON-RPC: los avisos van a stderr,
 * porque cualquier otra cosa en stdout rompe el protocolo.
 */
import { createInterface } from 'node:readline';

const BASE_URL = (process.env.AGENTDESK_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.AGENTDESK_TOKEN ?? '';
const ENDPOINT = `${BASE_URL}/api/mcp`;

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function warn(line) {
  process.stderr.write(`[agentdesk-mcp] ${line}\n`);
}

/**
 * Reenvía un mensaje y devuelve la respuesta, o null si no hubo ninguna.
 *
 * El 202 del servidor (una notificación, nada que contestar) se traduce aquí
 * en "no escribas nada", que es lo mismo que espera el cliente por stdio.
 */
async function forward(message) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (response.status === 202) return null;

  const text = await response.text();

  let parsed = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  // Un fallo de transporte o de credenciales no es un mensaje JSON-RPC: se
  // convierte en un error del protocolo para que el cliente lo vea en lugar de
  // quedarse esperando.
  if (!response.ok && (parsed === null || parsed.jsonrpc === undefined)) {
    const detail = parsed?.error ?? text.slice(0, 200) ?? `HTTP ${response.status}`;
    throw new Error(`${ENDPOINT} respondió ${response.status}: ${detail}`);
  }

  return parsed;
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON mal formado' } });
    return;
  }

  try {
    const response = await forward(message);
    if (response !== null) send(response);
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Error interno';
    // Sin id es una notificación: no se contesta ni para dar el error.
    if (message?.id === undefined) {
      warn(text);
      return;
    }
    send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: text } });
  }
}

async function listTools() {
  const response = await forward({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const tool of response?.result?.tools ?? []) {
    process.stdout.write(`${tool.name}\t${tool.description}\n`);
  }
}

function help() {
  process.stdout.write(
    [
      'Puente stdio del servidor MCP de AgentDesk.',
      '',
      'El servidor está en POST /api/mcp. Esto solo traduce stdio a esa ruta.',
      '',
      'Variables de entorno:',
      '  AGENTDESK_URL    http://192.168.1.50:3000  (obligatoria, sin barra final)',
      '  AGENTDESK_TOKEN  agt_…                     (obligatoria)',
      '',
      'Opciones:',
      '  --list   enumera las herramientas que publica el servidor',
      '  --help   esto',
      '',
      'Si tu cliente habla Streamable HTTP, no necesitas este fichero:',
      '  { "type": "streamable-http", "url": "http://192.168.1.50:3000/api/mcp",',
      '    "headers": { "Authorization": "Bearer agt_…" } }',
      '',
    ].join('\n'),
  );
}

function requireConfig() {
  const missing = [];
  if (!BASE_URL) missing.push('AGENTDESK_URL');
  if (!TOKEN) missing.push('AGENTDESK_TOKEN');

  if (missing.length > 0) {
    warn(`Falta ${missing.join(' y ')}.`);
    process.exit(1);
  }
}

// Un cliente que cierra la tubería mientras escribimos no es un fallo.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

async function main() {
  if (process.argv.includes('--help')) {
    help();
    return;
  }

  requireConfig();

  if (process.argv.includes('--list')) {
    await listTools();
    return;
  }

  // Las líneas se procesan en serie: el protocolo permite respuestas fuera de
  // orden, pero un cliente que las recibe ordenadas nunca se queja.
  let queue = Promise.resolve();
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });

  reader.on('line', (line) => {
    queue = queue.then(() => handleLine(line));
  });

  reader.on('close', () => {
    void queue.then(() => process.exit(0));
  });
}

void main().catch((error) => {
  warn(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
