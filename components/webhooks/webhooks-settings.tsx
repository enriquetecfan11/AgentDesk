'use client';

import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { copyText } from '@/lib/clipboard';
import { formatTimestamp } from '@/lib/dates';
import type { WebhookDTO, WebhookTestResultDTO } from '@/lib/types';
import { cn } from '@/lib/utils';
import { isWebhookEvent, QUIET_WEBHOOK_EVENTS, WEBHOOK_EVENTS, webhookEventLabel } from '@/lib/webhook';

type CreateResponse = { webhook: WebhookDTO; secret: string };
type UpdateResponse = { webhook: WebhookDTO; secret: string | null };

/**
 * Salidas: los webhooks que avisan a n8n (o a lo que sea) de lo que pasa aquí.
 *
 * Cada entrega va firmada con HMAC-SHA256 sobre su propio cuerpo, así que el
 * receptor puede comprobar que la petición viene de aquí y no de cualquiera que
 * sepa la URL.
 */
export function WebhooksSettings({ initialWebhooks }: { initialWebhooks: WebhookDTO[] }) {
  const router = useRouter();
  const [webhooks, setWebhooks] = useState(initialWebhooks);

  useEffect(() => setWebhooks(initialWebhooks), [initialWebhooks]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Webhook className="size-4 text-muted-foreground" />
          Webhooks
        </h2>
        <div className="ml-auto">
          <WebhookDialog onSaved={() => router.refresh()} />
        </div>
      </div>

      {webhooks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-xs text-muted-foreground">
            Ninguno configurado. Un webhook avisa a otra herramienta —n8n, por ejemplo— cuando pasa
            algo aquí: cada entrega lleva la firma HMAC en{' '}
            <code className="font-mono">X-AgentDesk-Signature</code>.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {webhooks.map((webhook) => (
            <WebhookRow key={webhook.id} webhook={webhook} />
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">
        El cuerpo es <code className="font-mono">{'{ event, at, delivery, data }'}</code>. Firma:{' '}
        <code className="font-mono">t=&lt;segundos&gt;,v1=HMAC_SHA256(secreto, &quot;t.cuerpo&quot;)</code>. Se
        envía también <code className="font-mono">X-AgentDesk-Event</code> con el nombre del evento.
        <br />
        Hay un receptor de referencia en <code className="font-mono">scripts/webhook-receiver.mjs</code>{' '}
        que verifica la firma y sirve para probar la cadena entera.
      </p>
    </section>
  );
}

function WebhookRow({ webhook }: { webhook: WebhookDTO }) {
  const router = useRouter();
  const [active, setActive] = useState(webhook.active);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function toggleActive(next: boolean) {
    setActive(next);
    try {
      await api.patch<UpdateResponse>(`/api/webhooks/${webhook.id}`, { active: next });
      toast.success(next ? 'Webhook activado' : 'Webhook pausado');
      router.refresh();
    } catch (error) {
      setActive(!next);
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado');
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const { result } = await api.post<{ result: WebhookTestResultDTO }>(
        `/api/webhooks/${webhook.id}/test`,
      );

      if (result.ok) {
        toast.success(`El receptor respondió ${result.status} en ${result.durationMs} ms`);
      } else {
        toast.error(result.error ?? 'El receptor no respondió bien');
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo probar el webhook');
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/api/webhooks/${webhook.id}`);
      toast.success('Webhook eliminado');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <li className={cn('space-y-2 p-3', !webhook.active && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{webhook.name}</span>

        <Switch
          checked={active}
          onCheckedChange={(next) => void toggleActive(next)}
          aria-label={`${active ? 'Pausar' : 'Activar'} ${webhook.name}`}
          className="scale-90"
        />

        <span className={cn('text-[11px]', webhook.active ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground')}>
          {webhook.active ? 'activo' : 'en pausa'}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => void runTest()}
            disabled={testing}
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Probar
          </Button>

          <WebhookDialog
            webhook={webhook}
            onSaved={() => router.refresh()}
            trigger={
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                <Pencil className="size-3.5" />
                Editar
              </Button>
            }
          />

          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 text-muted-foreground hover:text-red-600"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            aria-label={`Eliminar ${webhook.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <p className="truncate font-mono text-[11px] text-muted-foreground" title={webhook.url}>
        {webhook.url}
      </p>

      <ul className="flex flex-wrap gap-1">
        {webhook.events.map((event) => (
          <li
            key={event}
            className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {event === '*' ? 'todos los eventos' : webhookEventLabel(event)}
            {isWebhookEvent(event) && event !== webhookEventLabel(event) && (
              <span className="ml-1 font-mono text-[10px] opacity-70">{event}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted-foreground">
        {webhook.deliveryCount === 0 ? (
          'Sin entregas todavía.'
        ) : (
          <>
            {webhook.deliveryCount}{' '}
            {webhook.deliveryCount === 1 ? 'entrega' : 'entregas'}
            {webhook.failureCount > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {' '}
                · {webhook.failureCount} fallidas
              </span>
            )}
            {webhook.lastStatus !== null && <span> · última: HTTP {webhook.lastStatus}</span>}
            {webhook.lastDeliveryAt && <span> · {formatTimestamp(webhook.lastDeliveryAt)}</span>}
          </>
        )}
        {webhook.lastError && (
          <span className="block truncate text-red-600 dark:text-red-400" title={webhook.lastError}>
            {webhook.lastError}
          </span>
        )}
      </p>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{webhook.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de recibir eventos. El receptor no se entera: simplemente no llegará nada más.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
              disabled={busy}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * Create and edit share a dialog: only the shape of the answer changes.
 *
 * The secret is shown after creating or rotating, and only then, exactly like an
 * agent token — but unlike a token it can be rotated later, so a lost secret
 * does not mean recreating the endpoint.
 */
export function WebhookDialog({
  webhook,
  onSaved,
  trigger,
}: {
  webhook?: WebhookDTO;
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const editing = webhook !== undefined;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? [...QUIET_WEBHOOK_EVENTS]);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function reset() {
    setName(webhook?.name ?? '');
    setUrl(webhook?.url ?? '');
    setEvents(webhook?.events ?? [...QUIET_WEBHOOK_EVENTS]);
    setSecret(null);
  }

  function toggleEvent(event: string, enabled: boolean) {
    setEvents((previous) =>
      enabled ? [...new Set([...previous, event])] : previous.filter((value) => value !== event),
    );
  }

  async function submit() {
    if (name.trim().length === 0 || url.trim().length === 0) {
      toast.error('El nombre y la URL son obligatorios');
      return;
    }
    if (events.length === 0) {
      toast.error('Suscríbete al menos a un evento');
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        await api.patch<UpdateResponse>(`/api/webhooks/${webhook.id}`, {
          name: name.trim(),
          url: url.trim(),
          events,
        });
        toast.success('Webhook actualizado');
        onSaved();
        setOpen(false);
        reset();
      } else {
        const created = await api.post<CreateResponse>('/api/webhooks', {
          name: name.trim(),
          url: url.trim(),
          events,
        });
        toast.success('Webhook creado');
        onSaved();
        // The dialog stays open on the secret: closing it here would mean the
        // user never gets to read the value that signs every delivery.
        setSecret(created.secret);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!webhook) return;
    setBusy(true);
    try {
      const updated = await api.patch<UpdateResponse>(`/api/webhooks/${webhook.id}`, {
        rotateSecret: true,
      });
      if (updated.secret) {
        setSecret(updated.secret);
        toast.success('Secreto rotado');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo rotar el secreto');
    } finally {
      setBusy(false);
    }
  }
  const extraPatterns = events.filter((event) => !isWebhookEvent(event));
  const wildcard = events.includes('*');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      {trigger ?? (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          Nuevo webhook
        </Button>
      )}

      <DialogContent className="max-w-lg">
        {secret !== null ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4" />
                Copia el secreto
              </DialogTitle>
              <DialogDescription>
                Con él se firma cada entrega. Ponlo también en el receptor; AgentDesk no volverá a
                enseñarlo, pero puedes rotarlo cuando quieras desde «Editar».
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 text-xs">
                <code className="font-mono break-all">{secret}</code>
              </pre>

              <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                El receptor debe comparar su propia firma con la cabecera{' '}
                <code className="font-mono">X-AgentDesk-Signature</code>. El secreto no viaja en
                ninguna petición.
              </p>
            </div>

            <DialogFooter>
              <CopySecretButton secret={secret} />
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
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar webhook' : 'Nuevo webhook'}</DialogTitle>
              <DialogDescription>
                AgentDesk hará un POST a esta URL cada vez que ocurra uno de los eventos elegidos.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-name">Nombre</Label>
                <Input
                  id="webhook-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="p. ej. n8n"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">URL</Label>
                <Input
                  id="webhook-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="http://192.168.1.50:5678/webhook/agentdesk"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Debe ser alcanzable <em>desde este servidor</em>. El contenedor llega a tu máquina
                  en <code className="font-mono">host.docker.internal</code>; a otro equipo de la LAN,
                  por su IP.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Eventos</Label>

                <div className="flex items-start gap-2 rounded-md border border-border p-2">
                  <Checkbox
                    id="webhook-event-all"
                    checked={wildcard}
                    onCheckedChange={(checked) => setEvents(checked === true ? ['*'] : [])}
                    className="mt-0.5"
                  />
                  <Label htmlFor="webhook-event-all" className="text-xs font-normal leading-tight">
                    Todos los eventos
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">*</span>
                  </Label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <div key={event.name} className="flex items-start gap-2">
                      <Checkbox
                        id={`webhook-event-${event.name}`}
                        checked={wildcard || events.includes(event.name)}
                        disabled={wildcard}
                        onCheckedChange={(checked) => toggleEvent(event.name, checked === true)}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor={`webhook-event-${event.name}`}
                        className="text-xs font-normal leading-tight"
                      >
                        {event.label}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          {event.name}
                        </span>
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {event.description}
                        </span>
                      </Label>
                    </div>
                  ))}
                </div>

                {/* Patterns that only the API can create, kept visible so editing
                    from here does not silently drop them. */}
                {extraPatterns.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {extraPatterns.map((pattern) => (
                      <li key={pattern} className="flex items-center gap-1.5">
                        <Checkbox
                          id={`webhook-pattern-${pattern}`}
                          checked
                          onCheckedChange={() => toggleEvent(pattern, false)}
                          className="size-3.5"
                        />
                        <Label
                          htmlFor={`webhook-pattern-${pattern}`}
                          className="font-mono text-[11px] font-normal"
                        >
                          {pattern}
                        </Label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              {editing ? (
                <Button
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  onClick={() => void rotate()}
                  disabled={busy}
                >
                  Rotar secreto
                </Button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancelar
                </Button>
                <Button onClick={() => void submit()} disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                  {editing ? 'Guardar' : 'Crear'}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopySecretButton({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 shrink-0 gap-1.5 px-2 text-xs"
      onClick={async () => {
        const ok = await copyText(secret);
        setCopied(ok);
        if (ok) toast.success('Secreto copiado');
        else toast.error('No se pudo copiar: selecciónalo a mano');
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}
