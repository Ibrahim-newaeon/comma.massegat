// src/app/admin/layout.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/session';
import { t } from '@/lib/i18n/dict';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { SignOutButton } from '@/components/SignOutButton';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  // Server-side gate. UI hiding is cosmetic; route handlers re-authorize anyway.
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  if (user.mustChangePassword) redirect('/change-password');

  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const d = t(locale);

  // Admins must have TOTP enrolled before reaching any admin surface.
  if (!user.totpEnabled) redirect('/setup-2fa');

  return (
    <div className="min-h-screen">
      {/* flex-wrap: at 412px these controls cannot fit on one line. Without
          wrapping, sign-out overlaps page content and intercepts taps meant
          for the table beneath it. */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <nav className="flex items-center gap-2" aria-label={d.admin}>
          {/* An admin who arrived from chat has no way back except the browser
              button, which is invisible on mobile and on an installed PWA. */}
          <Link href="/chat" data-testid="back-to-chat" aria-label={d.back}
            className="touch-target flex items-center rounded-lg border border-[var(--border)] px-3 text-sm">
            ←
          </Link>
          <Link href="/admin/users" data-testid="nav-users"
            className="touch-target flex items-center rounded-md px-4 text-sm font-medium">
            {d.users}
          </Link>
          <Link href="/admin/audit" data-testid="nav-audit"
            className="touch-target flex items-center rounded-md px-4 text-sm font-medium">
            {d.auditLog}
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-[var(--muted)] sm:inline" data-testid="current-user">
            <bdi>{locale === 'ar' && user.displayNameAr ? user.displayNameAr : user.displayName}</bdi>
          </span>
          {/* The admin console had NO route to settings at any width. An
              admin who went there to approve someone could not get to their
              own password or language without editing the URL. */}
          <Link href="/profile" data-testid="admin-settings"
            aria-label={d.settings} title={d.settings}
            className="touch-target flex items-center rounded-md border border-[var(--border)] px-3 text-sm">
            ⚙
          </Link>
          <LocaleSwitch locale={locale} />
          <SignOutButton label={d.signOut} />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
