import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { countUsers, getSessionUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if ((await countUsers()) === 0) redirect('/setup');
  if (await getSessionUser()) redirect('/');

  return <LoginForm />;
}
