import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApi } from './openapi';
import { taskCreateSchema, taskUpdateSchema } from './validation';

type Operation = { tags: string[]; security: Record<string, unknown>[]; requestBody?: unknown };
const document = buildOpenApi('http://localhost:3000');
const paths = document.paths as unknown as Record<string, Record<string, Operation>>;

describe('OpenAPI', () => {
  it('covers every human and v1 handler without inventing methods', () => {
    function visit(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name === 'route.ts' && !file.includes('/mcp/') && !file.includes('/health/') && !file.includes('/openapi.json/')) {
          const path = '/' + file.replace(/^app\//, '').replace(/\/route.ts$/, '').replace(/\[([^\]]+)\]/g, '{$1}');
          const methods = [...readFileSync(file, 'utf8').matchAll(/export async function (GET|POST|PATCH|DELETE)\(/g)].map((m) => m[1].toLowerCase());
          expect(Object.keys(paths[path]).sort(), path).toEqual(methods.sort());
        }
      }
    }
    visit('app/api');
  });

  it('assigns security to each audience and keeps auth entry points public', () => {
    for (const [path, item] of Object.entries(paths)) {
      for (const operation of Object.values(item)) {
        if (path.startsWith('/api/v1/')) {
          expect(operation.tags).toEqual(['Agentes']);
          expect(operation.security).toEqual([{ bearerAuth: [] }]);
        } else if (!['/api/auth/login', '/api/auth/setup', '/api/auth/logout', '/api/artifacts/{id}'].includes(path)) {
          expect(operation.tags).toEqual(['Humano']);
          expect(operation.security).toEqual([{ cookieAuth: [] }]);
        }
      }
    }
    expect(paths['/api/auth/login'].post.security).toEqual([]);
    expect(paths['/api/artifacts/{id}'].get.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }]);
    expect(document.components.securitySchemes.cookieAuth).toMatchObject({ in: 'cookie', name: 'ad_session' });
  });

  it('generates input constraints from the handler Zod schemas', () => {
    const input = (schema: z.ZodType) => { const { $schema, ...value } = z.toJSONSchema(schema, { io: 'input' }); return value; };
    expect(document.components.schemas.TaskCreate).toEqual(input(taskCreateSchema));
    expect(document.components.schemas.TaskUpdate).toEqual(input(taskUpdateSchema));
    const body = paths['/api/tasks/{id}'].patch.requestBody;
    expect(body).toMatchObject({ content: { 'application/json': { schema: { properties: { labelIds: { maxItems: 20 } } } } } });
  });

  it('serializes with all local references resolved', () => {
    const serialized = JSON.stringify(document);
    const root = JSON.parse(serialized);
    for (const match of serialized.matchAll(/"\$ref":"#\/([^" ]+)"/g)) {
      const target = match[1].split('/').reduce((value, key) => value?.[key], root);
      expect(target, match[1]).toBeDefined();
    }
  });
});
