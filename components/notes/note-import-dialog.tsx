'use client';

import { FileUp, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';

/** Kept in step with `noteImportSchema`. */
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 500_000;

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  titles: string[];
};

/**
 * Brings a vault in.
 *
 * The files are read in the browser and posted as JSON: the server never
 * receives an archive, so there is no unzip step to exploit and the same
 * endpoint works with a multi-file selection from any file manager.
 */
export function NoteImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (summary: ImportSummary) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setSelected([]);
    setOverwrite(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleImport() {
    const files = inputRef.current?.files;
    if (!files || files.length === 0) {
      toast.error('Selecciona al menos un archivo .md');
      return;
    }

    const accepted: { name: string; content: string }[] = [];
    let tooBig = 0;

    for (const file of Array.from(files).slice(0, MAX_FILES)) {
      if (file.size > MAX_FILE_BYTES) {
        tooBig += 1;
        continue;
      }
      accepted.push({ name: file.name, content: await file.text() });
    }

    if (accepted.length === 0) {
      toast.error('Ningún archivo se puede importar (demasiado grandes).');
      return;
    }

    setBusy(true);
    try {
      const summary = await api.post<ImportSummary>('/api/notes/import', {
        files: accepted,
        overwrite,
      });

      if (tooBig > 0) toast.warning(`${tooBig} archivos ignorados por tamaño`);

      onImported(summary);
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar notas</DialogTitle>
          <DialogDescription>
            Selecciona los archivos <code className="font-mono">.md</code> de un vault de Obsidian.
            El título se toma del frontmatter, del nombre del archivo o del primer encabezado.
          </DialogDescription>
        </DialogHeader>

        <label
          htmlFor="note-import-files"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:bg-muted/50"
        >
          <FileUp className="size-5 text-muted-foreground" />
          <span className="text-sm">
            {selected.length > 0
              ? `${selected.length} ${selected.length === 1 ? 'archivo' : 'archivos'} seleccionados`
              : 'Elige archivos .md'}
          </span>
          <span className="text-xs text-muted-foreground">
            Puedes seleccionar varios a la vez, o todo el contenido de una carpeta.
          </span>
          <input
            ref={inputRef}
            id="note-import-files"
            type="file"
            multiple
            accept=".md,.markdown,text/markdown"
            className="sr-only"
            onChange={(event) => {
              setSelected(Array.from(event.target.files ?? []).map((file) => file.name));
            }}
          />
        </label>

        <div className="flex items-center gap-2">
          <Checkbox
            id="note-import-overwrite"
            checked={overwrite}
            onCheckedChange={(checked) => setOverwrite(checked === true)}
          />
          <Label htmlFor="note-import-overwrite" className="text-xs font-normal">
            Sobrescribir las notas que ya tengan el mismo título
          </Label>
        </div>

        <p className="text-xs text-muted-foreground">
          Nada se borra: si no marcas esta casilla, las notas con un título que ya existe se
          ignoran y se cuentan como omitidas.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void handleImport()} disabled={busy || selected.length === 0}>
            {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
