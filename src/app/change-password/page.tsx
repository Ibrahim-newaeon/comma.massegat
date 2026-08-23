// src/app/change-password/page.tsx
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/session';
import { t } from '@/lib/i18n/dict';
import { ChangePasswordForm } from './ChangePasswordForm';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const { setup } = await searchParams;
  const user = await getSessionUser();
  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const d = t(locale);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-2xl font-bold">{d.changePassword}</h1>
        {user?.mustChangePassword && (
          <p className="mb-4 text-sm text-[var(--muted)]" data-testid="must-change-notice">
            {d.mustChangePassword}
          </p>
        )}
        <ChangePasswordForm dict={d} setupToken={setup ?? null} hasSession={Boolean(user)} />
      </div>
    </main>
  );
}
