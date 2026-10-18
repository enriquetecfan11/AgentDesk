'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH } from '@/lib/constants';

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (tooShort || mismatch) return;

    setPending(true);
    setError(null);

    try {
      await api.post('/api/auth/setup', { name, email, password });
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear el usuario');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Crear el primer usuario</h1>
        <p className="text-sm text-muted-foreground">
          Esta es una instalación nueva. La cuenta que crees ahora será la propietaria del
          workspace.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          autoComplete="name"
          autoFocus
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby="password-help"
          aria-invalid={tooShort}
        />
        <p
          id="password-help"
          className={tooShort ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          Al menos {PASSWORD_MIN_LENGTH} caracteres.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm">Repite la contraseña</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-invalid={mismatch}
        />
        {mismatch && <p className="text-xs text-destructive">Las contraseñas no coinciden.</p>}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending || tooShort || mismatch}>
        {pending ? 'Creando…' : 'Crear usuario y entrar'}
      </Button>
    </form>
  );
}
