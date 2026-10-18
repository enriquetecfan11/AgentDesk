import { Construction } from 'lucide-react';

/**
 * Honest placeholder for sections that later phases implement. It is better to
 * say what is missing than to ship a dead link.
 */
export function ComingSoon({
  title,
  phase,
  description,
}: {
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <div className="grid place-items-center px-6 py-24 text-center">
      <div className="max-w-md space-y-3">
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
          <Construction className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Llega en la fase {phase}
        </p>
      </div>
    </div>
  );
}
