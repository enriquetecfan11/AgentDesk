import { describe, expect, it } from 'vitest';

import { loginSchema, projectCreateSchema, setupSchema, taskCreateSchema } from '@/lib/validation';

describe('setupSchema', () => {
  it('lowercases and trims the email', () => {
    const result = setupSchema.parse({
      name: '  Erique  ',
      email: '  ERIQUE@Example.COM ',
      password: 'una-contrasena-larga',
    });

    expect(result.email).toBe('erique@example.com');
    expect(result.name).toBe('Erique');
  });

  it('rejects short passwords', () => {
    const result = setupSchema.safeParse({
      name: 'Erique',
      email: 'erique@example.com',
      password: 'corta',
    });

    expect(result.success).toBe(false);
  });

  it('rejects malformed emails', () => {
    for (const email of ['sin-arroba', 'a@b', 'a b@c.com', '']) {
      expect(
        setupSchema.safeParse({ name: 'X', email, password: 'una-contrasena-larga' }).success,
      ).toBe(false);
    }
  });

  it('accepts a realistic address', () => {
    expect(
      setupSchema.safeParse({
        name: 'Erique',
        email: 'erique+agentdesk@example.com',
        password: 'una-contrasena-larga',
      }).success,
    ).toBe(true);
  });
});

describe('loginSchema', () => {
  it('does not enforce the password policy at login time', () => {
    // A user created before the policy changed must still be able to sign in.
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'corta' });
    expect(result.success).toBe(true);
  });

  it('still requires a password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('taskCreateSchema', () => {
  it('applies sensible defaults', () => {
    const task = taskCreateSchema.parse({ title: 'Revisar CVEs' });
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('none');
  });

  it('rejects a blank title', () => {
    expect(taskCreateSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('validates the due date format', () => {
    expect(taskCreateSchema.safeParse({ title: 'x', dueDate: '15/01/2026' }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'x', dueDate: '2026-01-15' }).success).toBe(true);
  });

  it('rejects a due time without the HH:MM shape', () => {
    expect(taskCreateSchema.safeParse({ title: 'x', dueTime: '9:30' }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'x', dueTime: '09:30' }).success).toBe(true);
  });

  it('rejects a non-uuid project id', () => {
    expect(taskCreateSchema.safeParse({ title: 'x', projectId: 'nope' }).success).toBe(false);
  });
});

describe('projectCreateSchema', () => {
  it('uppercases the identifier and limits it to alphanumerics', () => {
    expect(projectCreateSchema.parse({ name: 'Wazuh', identifier: 'waz' }).identifier).toBe('WAZ');
    expect(projectCreateSchema.safeParse({ name: 'Wazuh', identifier: 'w-a' }).success).toBe(false);
  });
});
