'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
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
import { PROJECT_COLORS, PROJECT_STATUS_META } from '@/lib/constants';
import type { ProjectDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export type ProjectFormValues = {
  name: string;
  identifier: string | null;
  description: string | null;
  status: ProjectDTO['status'];
  color: string | null;
  targetDate: string | null;
};

const EMPTY: ProjectFormValues = {
  name: '',
  identifier: null,
  description: null,
  status: 'active',
  color: PROJECT_COLORS[0],
  targetDate: null,
};

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  project?: ProjectDTO | null;
  onSubmit: (values: ProjectFormValues) => Promise<unknown>;
}) {
  const [values, setValues] = useState<ProjectFormValues>(EMPTY);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(
      project
        ? {
            name: project.name,
            identifier: project.identifier,
            description: project.description,
            status: project.status,
            color: project.color ?? PROJECT_COLORS[0],
            targetDate: project.targetDate,
          }
        : EMPTY,
    );
  }, [open, project]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) return;

    setPending(true);
    await onSubmit({
      ...values,
      name: values.name.trim(),
      identifier: values.identifier?.trim().toUpperCase() || null,
      description: values.description?.trim() || null,
    });
    setPending(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{project ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle>
            <DialogDescription className="sr-only">
              Un proyecto agrupa tareas y notas bajo un mismo objetivo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="project-name">Nombre</Label>
            <Input
              id="project-name"
              autoFocus
              required
              maxLength={120}
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-identifier">Identificador</Label>
              <Input
                id="project-identifier"
                placeholder="WAZ"
                maxLength={6}
                value={values.identifier ?? ''}
                onChange={(event) =>
                  setValues({ ...values, identifier: event.target.value.toUpperCase() || null })
                }
                className="font-mono uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-target">Fecha objetivo</Label>
              <Input
                id="project-target"
                type="date"
                value={values.targetDate ?? ''}
                onChange={(event) =>
                  setValues({ ...values, targetDate: event.target.value || null })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-status">Estado</Label>
            <Select
              value={values.status}
              onValueChange={(next) =>
                setValues({ ...values, status: next as ProjectDTO['status'] })
              }
            >
              <SelectTrigger id="project-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROJECT_STATUS_META).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setValues({ ...values, color })}
                  aria-label={`Color ${color}`}
                  aria-pressed={values.color === color}
                  className={cn(
                    'size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    values.color === color && 'ring-2 ring-ring',
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">Descripción</Label>
            <Textarea
              id="project-description"
              rows={3}
              maxLength={5000}
              value={values.description ?? ''}
              onChange={(event) =>
                setValues({ ...values, description: event.target.value || null })
              }
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !values.name.trim()}>
              {pending ? 'Guardando…' : project ? 'Guardar cambios' : 'Crear proyecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
