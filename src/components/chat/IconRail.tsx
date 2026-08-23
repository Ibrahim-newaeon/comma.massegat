'use client';
// src/components/chat/IconRail.tsx
import Link from 'next/link';
import { Avatar } from '@/components/chat/Avatar';
import type { Dict, Locale } from '@/lib/i18n/dict';

/**
 * App-level actions live here so the channel header can be about the CHANNEL.
 * Header space is finite; Slack, Discord and Teams all converged on this for
 * the same reason.
 */
export function IconRail({
  dict, locale, me, sound, pushState, unreadTotal,
  onSearch, onToggleSound, onEnablePush, onSwitchLocale,
}: {
  dict: Dict;
  locale: Locale;
  me: { id: string; displayName: string; role: string };
  sound: boolean;
  pushState: NotificationPermission | 'unsupported';
  unreadTotal: number;
  onSearch: () => void;
  onToggleSound: () => void;
  onEnablePush: () => void;
  onSwitchLocale: () => void;
}) {
  // Every control is 44px — below the 56px touch minimum, which is why the
  // rail is HIDDEN on mobile. There the drawer and header carry these instead.
  const button = 'flex h-11 w-11 items-center justify-center rounded-lg text-lg hover:bg-[var(--surface)]';

  return (
    <nav
      aria-label={dict.appName}
      data-testid="icon-rail"
      className="hidden w-14 shrink-0 flex-col items-center gap-1 border-e border-[var(--border)] py-2 md:flex"
    >
      <span
        aria-hidden
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-medium text-[var(--accent-on)]"
      >
        C
      </span>

      <button type="button" onClick={onSearch} data-testid="rail-search"
        aria-label={dict.search} className={button}>
        🔍
      </button>

      <button type="button" onClick={onToggleSound} data-testid="rail-sound"
        data-enabled={sound}
        aria-pressed={sound}
        aria-label={sound ? dict.muteSound : dict.unmuteSound} className={button}>
        {sound ? '🔔' : '🔕'}
      </button>

      {pushState !== 'unsupported' && pushState !== 'granted' && (
        <button type="button" onClick={onEnablePush} data-testid="rail-push"
          disabled={pushState === 'denied'}
          title={pushState === 'denied' ? dict.notificationsBlocked : undefined}
          aria-label={dict.enableNotifications}
          className={`${button} disabled:opacity-40`}>
          <span className="relative">
            🔔
            <span aria-hidden className="absolute -end-1 -top-1 text-[10px]">+</span>
          </span>
        </button>
      )}

      <span className="flex-1" />

      {me.role === 'admin' && (
        <Link href="/admin/users" data-testid="rail-admin"
          aria-label={dict.admin} className={button}>
          ⚙
        </Link>
      )}

      <button type="button" onClick={onSwitchLocale} data-testid="rail-locale"
        aria-label={locale === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
        className={`${button} text-xs`}>
        {locale === 'en' ? 'ع' : 'EN'}
      </button>

      {/* A visible sign-out. It lived on the profile page, two clicks deep —
          which is the wrong place for the control someone reaches for when
          they are leaving a shared machine. */}
      <form action="/api/auth/logout" method="post">
        <button type="submit" data-testid="rail-logout"
          aria-label={dict.logout} title={dict.logout} className={button}>
          ⏻
        </button>
      </form>

      <Link href="/profile" data-testid="rail-profile" aria-label={dict.profile}
        className="mt-1 rounded-full" title={me.displayName}>
        <Avatar userId={me.id} name={me.displayName} size={30} />
      </Link>

      {/* Screen readers get the unread total once, here, rather than counting
          badges scattered through the sidebar. */}
      <span className="sr-only" aria-live="polite" data-testid="rail-unread-total">
        {unreadTotal > 0 ? `${unreadTotal} unread` : ''}
      </span>
    </nav>
  );
}
