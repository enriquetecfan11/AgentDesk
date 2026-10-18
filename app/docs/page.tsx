import Link from 'next/link';
import { ApiReference } from './reference';
import { ThemeToggle } from '@/components/shell/theme-toggle';

export const metadata = { title: 'Documentación API · AgentDesk' };

export default function DocsPage() {
  return (
    <main>
      <header className="flex items-center justify-between border-b px-4 py-2">
        <Link href="/" className="font-medium">AgentDesk</Link>
        <div className="flex items-center gap-4">
          <a href="/api/openapi.json" className="text-sm underline">OpenAPI JSON</a>
          <ThemeToggle />
        </div>
      </header>
      <ApiReference />
    </main>
  );
}
