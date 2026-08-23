// src/app/setup-2fa/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { t } from '@/lib/i18n/dict';
import { TotpEnroll } from './TotpEnroll';

export default async function TotpPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.totpEnabled) redirect('/admin/users');

  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-bold">Two-factor authentication</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Required for admin accounts. Scan the QR code with your authenticator app.
      </p>
      <TotpEnroll dict={t(locale)} />
    </main>
  );
}
