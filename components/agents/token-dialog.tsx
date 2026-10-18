'use client';

import { Check, Copy, KeyRound, Loader2, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FULL_ACCESS_SCOPES,
  SCOPE_GROUPS,
  scopeLabel,
  type AgentScope,
} from '@/lib/agent-token';
import { api } from '@/lib/api-client';
import { copyText } from '@/lib/clipboard';
import type { ApiTokenCreatedDTO } from '@/lib/types';

/** What a fresh agent needs to be useful: read and write its own work. */
const DEFAULT_SCOPES: AgentScope[] = [
  'tasks:read',
  'tasks:write',
  'delegations:read',
  'delegations:write',
  'runs:read',
  'runs:write',
  'notes:read',
  'notes:write',
];

/**
 * Issues a token and shows it exactly once.
 *
 * The dialog deliberately has two steps: while the scope picker is on screen
 * there is nothing to copy, and once the secret appears the only way out is a
 * button that says the value will not be shown again.
 */
export function NewTokenDialog({
  agentId,
  baseUrl,
  onCreated,
}: {
  agentId: string;
  baseUrl: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('default');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState<'config' | 'command' | null>(null);

  function reset() {
    setName('default');
    setScopes(DEFAULT_SCOPES);
    setSecret(null);
    setCopied(false);
    setMcpCopied(null);
  }

  function toggleScope(scope: AgentScope, enabled: boolean) {
    setScopes((previous) =>
      enabled ? [...new Set([...previous, scope])] : previous.filter((value) => value !== scope),
    );
  }

  async function submit() {
    if (scopes.length === 0) {
      toast.error('Elige al menos un scope');
      return;
    }

    setBusy(true);
    try {
      const created = await api.post<ApiTokenCreatedDTO>(`/api/agents/${agentId}/tokens`, {
        name: name.trim() || 'default',
        scopes,
      });

      setSecret(created.secret);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el token');
    } finally {
      setBusy(false);
    }
  }

  const mcpConfig = secret
    ? JSON.stringify(
        {
          mcpServers: {
            agentdesk: {
              type: 'streamable-http',
              url: `${baseUrl}/api/mcp`,
              headers: {
                Authorization: `Bearer ${secret}`,
              },
            },
          },
        },
        null,
        2,
      )
    : '';
  const mcpCommand = secret
    ? `curl -N -X POST ${baseUrl}/api/mcp -H "Authorization: Bearer ${secret}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'`
    : '';

  async function copyMcp(value: string, kind: 'config' | 'command') {
    const ok = await copyText(value);
    setMcpCopied(ok ? kind : null);
    toast[ok ? 'success' : 'error'](ok ? 'Configuración MCP copiada' : 'No se pudo copiar');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        Crear token
      </Button>

      <DialogContent className="max-w-lg">
        {secret === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Nuevo token</DialogTitle>
              <DialogDescription>
                El token se muestra una sola vez. Guárdalo donde vayas a usarlo: aquí solo quedará su
                prefijo.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="token-name">Nombre</Label>
                <Input
                  id="token-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="p. ej. n8n producción"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Scopes</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-muted-foreground"
                    onClick={() =>
                      setScopes(
                        scopes.length === FULL_ACCESS_SCOPES.length ? [] : [...FULL_ACCESS_SCOPES],
                      )
                    }
                  >
                    {scopes.length === FULL_ACCESS_SCOPES.length ? 'Quitar todos' : 'Seleccionar todos'}
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {SCOPE_GROUPS.map((group) => (
                    <fieldset key={group.area} className="rounded-md border border-border p-2">
                      <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </legend>
                      <div className="space-y-1.5">
                        {group.scopes.map((scope) => (
                          <div key={scope} className="flex items-start gap-2">
                            <Checkbox
                              id={`scope-${scope}`}
                              checked={scopes.includes(scope)}
                              onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                              className="mt-0.5"
                            />
                            <Label
                              htmlFor={`scope-${scope}`}
                              className="text-xs font-normal leading-tight"
                            >
                              {scopeLabel(scope)}
                              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                                {scope}
                              </span>
                            </Label>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Escribir implica leer: <code className="font-mono">tasks:write</code> ya incluye
                  <code className="font-mono"> tasks:read</code>.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={() => void submit()} disabled={busy}>
                {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Crear token
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4" />
                Copia el token ahora
              </DialogTitle>
              <DialogDescription>
                No se vuelve a mostrar. Si se pierde, se revoca y se crea otro.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 text-xs">
                <code className="font-mono break-all">{secret}</code>
              </pre>

              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  Se guarda solo su hash, así que no hay forma de recuperarlo. Colócalo en el
                  <code className="font-mono"> .env</code> del agente, nunca en el repositorio.
                </p>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <div>
                  <p className="text-xs font-medium">Conectar por MCP</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Pega este bloque en la configuración de tu cliente MCP y cambia solo la ruta del
                    servidor si hace falta.
                  </p>
                </div>
                <div className="relative">
                  <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-2 pr-16 text-[10px] leading-relaxed">
                    <code className="font-mono">{mcpConfig}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute right-2 top-2 h-7 gap-1 px-2 text-[10px]"
                    onClick={() => void copyMcp(mcpConfig, 'config')}
                  >
                    {mcpCopied === 'config' ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {mcpCopied === 'config' ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-md border border-border bg-background p-2 pr-16 text-[10px] leading-relaxed">
                    <code className="font-mono">{mcpCommand}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute right-2 top-2 h-7 gap-1 px-2 text-[10px]"
                    onClick={() => void copyMcp(mcpCommand, 'command')}
                  >
                    {mcpCopied === 'command' ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {mcpCopied === 'command' ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyText(secret);
                  setCopied(ok);
                  if (ok) toast.success('Token copiado');
                  else toast.error('No se pudo copiar: selecciónalo a mano');
                }}
              >
                {copied ? <Check className="mr-1.5 size-3.5" /> : <Copy className="mr-1.5 size-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Ya lo he guardado
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
