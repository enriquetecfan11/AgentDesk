import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-7 place-items-center rounded bg-foreground text-xs font-bold text-background">
          AD
        </span>
        <span className="text-sm font-semibold tracking-tight">AgentDesk</span>
      </Link>

      <div className="w-full max-w-sm">{children}</div>

      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        Instalación self-hosted. Los datos no salen de tu red.
      </p>
    </div>
  );
}
