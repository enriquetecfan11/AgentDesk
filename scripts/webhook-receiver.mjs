#!/usr/bin/env node
/**
 * Receptor de webhooks de referencia.
 *
 * Sirve para probar la cadena entera —firma incluida— sin montar n8n:
 *
 *   AGENTDESK_WEBHOOK_SECRET=whsec_… node scripts/webhook-receiver.mjs 4599 /tmp/agentdesk.jsonl
 *
 * Escucha en 0.0.0.0:4599, comprueba la cabecera `X-AgentDesk-Signature` y
 * escribe una línea JSON por entrega (o la imprime por stdout si no le das
 * fichero). Responde 200 y no hace nada más.
 *
 * La verificación es la misma que la de `lib/webhook-signature.ts`:
 * `HMAC_SHA256(secreto, "<t>.<cuerpo>")` en hexadecimal, con ±5 minutos de
 * tolerancia para no depender de que los relojes coincidan.
 *
 * Si se lanza dentro del contenedor de la app, la URL del webhook sería
 * `http://127.0.0.1:4599/hook`; si se lanza en la máquina anfitriona, desde el
 * contenedor se llega en `http://host.docker.internal:4599/hook`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? process.env.PORT ?? 4599);
const logFile = process.argv[3] ?? null;
const secret = process.env.AGENTDESK_WEBHOOK_SECRET ?? '';
const toleranceSeconds = Number(process.env.AGENTDESK_WEBHOOK_TOLERANCE ?? 300);

function verifySignature(header, body) {
  if (secret.length === 0) return null; // Sin secreto no se verifica: solo se registra.
  if (!header) return false;

  const parts = new Map(
    header
      .split(',')
      .map((piece) => piece.trim().split('=', 2))
      .filter((pair) => pair.length === 2),
  );

  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1');
  if (!Number.isFinite(timestamp) || !signature) return false;

  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'),
    'utf8',
  );
  const received = Buffer.from(signature, 'utf8');

  return expected.length === received.length && timingSafeEqual(expected, received);
}

const server = createServer((request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'Content-Type': 'application/json' });
    response.end('{"error":"solo POST"}');
    return;
  }

  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });

  request.on('end', () => {
    const signatureValid = verifySignature(request.headers['x-agentdesk-signature'], body);

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }

    const entry = {
      at: new Date().toISOString(),
      event: request.headers['x-agentdesk-event'] ?? parsed?.event ?? null,
      delivery: request.headers['x-agentdesk-delivery'] ?? parsed?.delivery ?? null,
      signatureValid,
      payload: parsed,
    };

    const line = JSON.stringify(entry);
    if (logFile) appendFileSync(logFile, `${line}\n`);
    else process.stdout.write(`${line}\n`);

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
});

server.listen(port, '0.0.0.0', () => {
  process.stderr.write(
    `[webhook-receiver] escuchando en 0.0.0.0:${port}` +
      `${secret ? ' (firma verificada)' : ' (sin secreto: no se verifica)'}` +
      `${logFile ? ` → ${logFile}` : ''}\n`,
  );
});
