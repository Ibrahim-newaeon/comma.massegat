'use client';
// src/components/chat/ChatHeader.tsx
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MobileMenu } from '@/components/chat/MobileMenu';
import type { Dict, Locale } from '@/lib/i18n/dict';

export function ChatHeader({
  dict, locale, user, onNewGroup, soundOn, onToggleSound,
}: {
  dict: Dict;
  locale: Locale;
  user: { displayName: string; displayNameAr: string | null; role: string };
  /** Opens the group dialog. Starting a DM lives in the People list now. */
  onNewGroup: () => void;
  /** Threaded through for the mobile menu — below md there is nowhere else
      to put the sound control. */
  soundOn: boolean;
  onToggleSound: () => void;
}) {
  const router = useRouter();
  function switchLocale() {
    const next = locale === 'en' ? 'ar' : 'en';
    document.cookie = `cp_locale=${next}; path=/; max-age=31536000; samesite=strict`;
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3">
      <div className="flex items-center gap-3">
        <h1 className="font-bold">{dict.appName}</h1>
        <button
          type="button"
          onClick={onNewGroup}
          data-testid="new-group"
          className="touch-target rounded-lg border border-[var(--border)] px-3 text-sm"
        >
          + {dict.newGroup}
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Below sm the name link is hidden and the icon rail is gone entirely,
            so this gear is the ONLY route to settings on a phone. A name is
            also not a control — nobody taps their own name looking for
            preferences. */}
        <Link href="/profile" data-testid="header-settings"
          aria-label={dict.settings} title={dict.settings}
          className="touch-target flex items-center rounded-md border border-[var(--border)] px-3 text-sm sm:hidden">
          ⚙
        </Link>

        <Link href="/profile" data-testid="header-profile"
          className="hidden touch-target items-center rounded-md px-2 text-sm text-[var(--muted)] sm:flex">
          <bdi dir="auto" data-testid="current-user">
            {locale === 'ar' && user.displayNameAr ? user.displayNameAr : user.displayName}
          </bdi>
        </Link>
        {user.role === 'admin' && (
          <Link href="/admin/users" data-testid="nav-admin"
            className="touch-target hidden items-center rounded-md border border-[var(--border)] px-3 text-sm md:flex">
            {dict.admin}
          </Link>
        )}

        {/* Below md the icon rail is hidden, so this is the ONLY route to
            profile, sound and sign-out. Without it a phone user could not log
            out at all. */}
        <MobileMenu
          dict={dict}
          isAdmin={user.role === 'admin'}
          soundOn={soundOn}
          onToggleSound={onToggleSound}
        />
        <button type="button" onClick={switchLocale} data-testid="locale-switch"
          aria-label={locale === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
          className="touch-target rounded-md border border-[var(--border)] px-3 text-sm">
          {locale === 'en' ? 'العربية' : 'English'}
        </button>
      </div>
    </header>
  );
}
