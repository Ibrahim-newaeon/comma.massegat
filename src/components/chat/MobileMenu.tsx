'use client';
// src/components/chat/MobileMenu.tsx
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { csrfToken } from '@/lib/csrfClient';
import type { Dict } from '@/lib/i18n/dict';

/**
 * Everything the icon rail offers, for phones.
 *
 * The rail is `hidden md:flex` and the profile link `hidden sm:flex`, so below
 * those breakpoints a user had no route to their profile, their settings, or
 * sign-out. An admin could reach the admin console and nothing else — including
 * no way to log out on a shared phone.
 */
export function MobileMenu({
  dict, isAdmin, soundOn, onToggleSound,
}: {
  dict: Dict;
  isAdmin: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a menu that only closes via its own
  // button is a trap on a phone, where there is no obvious "elsewhere".
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken() },
    }).catch(() => { /* sign out locally regardless */ });
    // Full navigation, not router.push: it discards every piece of client
    // state, which is the point of signing out on a shared phone.
    window.location.href = '/login';
  }

  const item = 'flex w-full items-center gap-3 px-4 py-3 text-start text-sm hover:bg-[var(--surface)]';

  return (
    <div ref={wrap} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="mobile-menu-button"
        aria-label={dict.menu}
        aria-expanded={open}
        aria-haspopup="menu"
        className="touch-target rounded-md border border-[var(--border)] px-3 text-lg"
      >
        ⋮
      </button>

      {open && (
        <div
          role="menu"
          data-testid="mobile-menu"
          // end-0 not right-0: in Arabic the menu must open from the other
          // side, or it hangs off the screen edge.
          className="absolute end-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-lg"
        >
          <Link href="/profile" role="menuitem" data-testid="mobile-profile"
            onClick={() => setOpen(false)} className={item}>
            <span aria-hidden>👤</span>{dict.profile}
          </Link>

          {isAdmin && (
            <Link href="/admin/users" role="menuitem" data-testid="mobile-admin"
              onClick={() => setOpen(false)} className={item}>
              <span aria-hidden>⚙</span>{dict.admin}
            </Link>
          )}

          <button type="button" role="menuitem" data-testid="mobile-sound"
            onClick={() => { onToggleSound(); setOpen(false); }} className={item}>
            <span aria-hidden>{soundOn ? '🔔' : '🔕'}</span>
            {soundOn ? dict.muteSound : dict.unmuteSound}
          </button>

          <button type="button" role="menuitem" data-testid="mobile-logout"
            onClick={signOut}
            className={`${item} border-t border-[var(--border)] text-[var(--danger)]`}>
            <span aria-hidden>⏻</span>{dict.logout}
          </button>
        </div>
      )}
    </div>
  );
}
