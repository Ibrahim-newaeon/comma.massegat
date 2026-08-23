// src/app/login/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { t } from '@/lib/i18n/dict';
import { LoginForm } from './LoginForm';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import Link from 'next/link';
import { env } from '@/env';

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect('/');

  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const d = t(locale);

  // Only linked when signup is actually configured. A visible link to a route
  // that always refuses is worse than no link.
  const signupOpen = env.SIGNUP_ALLOWED_DOMAINS.split(',').some((x) => x.trim());

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold" data-testid="app-name">{d.appName}</h1>
          <LocaleSwitch locale={locale} />
        </div>
        <LoginForm dict={d} />

        {signupOpen && (
          <p className="mt-4 text-center text-sm">
            <Link href="/signup" data-testid="to-signup" className="text-[var(--accent)]">
              {d.createAccount}
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
