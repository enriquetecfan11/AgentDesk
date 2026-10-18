import Link from 'next/link';

import { SetupForm } from '@/components/auth/setup-form';
import { countUsers } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  // The wizard only exists while the installation has no users at all.
  if ((await countUsers()) > 0) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-5">
        <h1 className="text-lg font-semibold tracking-tight">
          La instalación ya está configurada
        </h1>
        <p className="text-sm text-muted-foreground">
          Ya existe un usuario, así que este asistente está deshabilitado.
        </p>
        <Link
          href="/login"
          className="inline-block text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  return <SetupForm />;
}
