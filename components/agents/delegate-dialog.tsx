'use client';

import { Loader2, Send } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import type { DelegationDTO } from '@/lib/types';

const NO_TASK = '__none__';

/** Hands work to an agent, optionally tied to a task. */
export function DelegateDialog({
  agentId,
  agentName,
  tasks,
  onCreated,
}: {
  agentId: string;
  agentName: string;
  tasks: { id: string; title: string; status: string }[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState<string>(NO_TASK);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTaskId(NO_TASK);
    setTitle('');
    setInstructions('');
    setRequiresApproval(false);
  }

  async function submit() {
    const finalTitle =
      title.trim() || tasks.find((task) => task.id === taskId)?.title.trim() || '';

    if (finalTitle.length === 0) {
      toast.error('Pon un título o elige una tarea');
      return;
    }

    setBusy(true);
    try {
      await api.post<{ delegation: DelegationDTO }>('/api/delegations', {
        toAgentId: agentId,
        title: finalTitle,
        instructions: instructions.trim() || null,
        taskId: taskId === NO_TASK ? null : taskId,
        requiresApproval,
      });

      toast.success(`Delegado a ${agentName}`);
      setOpen(false);
      reset();
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo delegar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setOpen(true)}>
        <Send className="size-3.5" />
        Delegar
      </Button>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delegar a {agentName}</DialogTitle>
          <DialogDescription>
            La delegación aparece en la cola del agente (<code className="font-mono">/api/v1/queue</code>
            ) hasta que la acepte y la cierre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="delegation-task">Tarea (opcional)</Label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger id="delegation-task" className="text-sm">
                <SelectValue placeholder="Sin tarea" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TASK}>Sin tarea asociada</SelectItem>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delegation-title">Título</Label>
            <Input
              id="delegation-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Qué hay que hacer"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delegation-instructions">Instrucciones</Label>
            <Textarea
              id="delegation-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              placeholder="Contexto, límites y qué se considera terminado"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="delegation-approval"
              checked={requiresApproval}
              onCheckedChange={(checked) => setRequiresApproval(checked === true)}
            />
            <Label htmlFor="delegation-approval" className="text-xs font-normal">
              Exigir mi aprobación antes de que empiece
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Delegar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
