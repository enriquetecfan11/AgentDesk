'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Check, Copy, KeyRound, Loader2, Plus, Power, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { BadgeDot, StatusBadge, OriginBadge } from '@/components/ui/badge-dot';
import {
  createAutomation, deleteAutomation, listAutomationLog, listAutomations, updateAutomation,
} from '@/lib/api';
import type { Automation } from '@/lib/types';

export function AutomationsSection() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [log, setLog] = useState<Record<string, { id: string; action: string; created_at: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await listAutomations();
      setAutomations(a);
      const entries = await Promise.all(a.map(async (x) => [x.id, (await listAutomationLog({ automationId: x.id })).slice(0, 5)] as const));
      setLog(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { automation, secret } = await createAutomation({ name: name.trim() });
      setNewSecret({ name: automation.name, secret });
      setName('');
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (a: Automation) => {
    await updateAutomation(a.id, { status: a.status === 'active' ? 'paused' : 'active' });
    load();
  };

  const remove = async (a: Automation) => {
    await deleteAutomation(a.id);
    load();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Automatizaciones (n8n)
        </h3>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => setCreating((c) => !c)}>
          <Plus className="h-3 w-3" /> Registrar
        </Button>
      </div>

      {newSecret && (
        <div className="space-y-2 rounded-lg border border-[hsl(var(--ring))] bg-accent-muted/60 p-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold">
            <KeyRound className="h-3.5 w-3.5 text-accent" />
            Secreto de {newSecret.name} — cópialo ahora, no se volverá a mostrar
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2.5 py-1.5 font-mono text-[11px]">
              {newSecret.secret}
            </code>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => navigator.clipboard.writeText(newSecret.secret)}>
              <Copy className="h-3 w-3" /> Copiar
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setNewSecret(null)}>
              <Check className="h-3 w-3" /> Listo
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            n8n lo envía en la cabecera <span className="font-mono">X-N8N-Secret</span> al webhook de ingestión.
          </p>
        </div>
      )}

      {creating && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5">
          <Input placeholder="Nombre del workflow (ej: mail-parser)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} className="h-8 text-[12px]" />
          <Button size="sm" className="h-8 gap-1.5 shrink-0" disabled={busy || !name.trim()} onClick={create}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Registrar
          </Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-14 w-full" />
      ) : automations.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-muted-foreground">
          Sin automatizaciones registradas. Registra un workflow de n8n y usa su secreto en el webhook de ingestión.
        </p>
      ) : (
        <div className="space-y-2">
          {automations.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <BadgeDot color="#3b82f6" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{a.name}</span>
                <StatusBadge label={a.status === 'active' ? 'Activa' : 'Pausada'} color={a.status === 'active' ? '#22c55e' : '#6b7280'} />
                <Button variant="ghost" size="icon" className="h-6 w-6" title={a.status === 'active' ? 'Pausar' : 'Activar'} onClick={() => toggle(a)}>
                  <Power className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Eliminar" onClick={() => remove(a)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-mono">secreto: {a.secret_prefix}…</span>
                <span>permisos: {a.permissions.join(', ')}</span>
              </div>
              {(log[a.id]?.length ?? 0) > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {log[a.id].map((l) => (
                    <div key={l.id} className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
                      <OriginBadge origin="automation" />
                      <span className="font-mono">{l.action}</span>
                      <span className="ml-auto">{formatDistanceToNow(new Date(l.created_at), { locale: es, addSuffix: true })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
