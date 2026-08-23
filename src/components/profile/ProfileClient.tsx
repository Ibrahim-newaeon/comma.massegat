'use client';
// src/components/profile/ProfileClient.tsx
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiPatch, csrfToken, ApiError } from '@/lib/csrfClient';
import { Avatar } from '@/components/chat/Avatar';
import { ThemeToggle, type Theme } from '@/components/profile/ThemeToggle';
import { formatDateTime, type Dict, type Locale } from '@/lib/i18n/dict';

type Me = {
  user: {
    id: string; email: string; displayName: string; displayNameAr: string | null;
    locale: string; theme: string; role: string; createdAt: string; lastLoginAt: string | null;
  };
  totpEnabled: boolean;
  storage: { usedBytes: number; quotaBytes: number; fileCount: number };
  pushDevices: number;
};

type Session = {
  id: string; device: string; ipAddress: string | null;
  signedInAt: string; lastSeenAt: string; twoFactor: boolean; isCurrent: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function ProfileClient({ dict, locale }: { dict: Dict; locale: Locale }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [displayNameAr, setDisplayNameAr] = useState('');
  const [prefLocale, setPrefLocale] = useState<'en' | 'ar'>('en');
  const [theme, setTheme] = useState<Theme>('system');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const [meRes, sessRes] = await Promise.all([
        fetch('/api/me').then((r) => r.json()),
        fetch('/api/me/sessions').then((r) => r.json()),
      ]);
      if (meRes.ok) {
        setMe(meRes.data);
        setDisplayName(meRes.data.user.displayName);
        setDisplayNameAr(meRes.data.user.displayNameAr ?? '');
        setPrefLocale(meRes.data.user.locale === 'ar' ? 'ar' : 'en');
        setTheme((meRes.data.user.theme ?? 'system') as Theme);
      }
      if (sessRes.ok) setSessions(sessRes.data.sessions);
    } catch {
      setStatus({ kind: 'error', text: dict.error });
    }
  }, [dict.error]);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile() {
    setBusy(true);
    setStatus(null);
    try {
      await apiPatch('/api/me', {
        displayName: displayName.trim(),
        displayNameAr: displayNameAr.trim() || null,
        locale: prefLocale,
        theme,
      });
      // The cookie drives the CURRENT render; the stored preference drives
      // push notifications. Both must move together or a user reads Arabic in
      // the app and receives English notifications.
      document.cookie = `cp_locale=${prefLocale}; path=/; max-age=31536000; samesite=strict`;
      setStatus({ kind: 'ok', text: dict.saved });
      router.refresh();
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof ApiError ? e.message : dict.error });
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      setStatus({ kind: 'error', text: dict.passwordsDoNotMatch });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!json.ok) throw new ApiError(json.error?.code ?? 'ERROR', json.error?.message ?? dict.error);

      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      // Changing a password revokes every other session server-side, so the
      // list on screen is now wrong.
      setStatus({ kind: 'ok', text: dict.passwordChanged });
      void load();
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof ApiError ? e.message : dict.error });
    } finally {
      setBusy(false);
    }
  }

  async function revokeSessions(familyId?: string) {
    setBusy(true);
    try {
      await fetch('/api/me/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify(familyId ? { familyId } : {}),
      });
      setStatus({ kind: 'ok', text: dict.sessionsRevoked });
      void load();
    } catch {
      setStatus({ kind: 'error', text: dict.error });
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <main className="p-6"><p>{dict.loading}</p></main>;

  const pct = Math.min(100, Math.round((me.storage.usedBytes / me.storage.quotaBytes) * 100));
  const label = locale === 'ar' && me.user.displayNameAr ? me.user.displayNameAr : me.user.displayName;

  const card = 'mb-4 rounded-lg border border-[var(--border)] p-4';
  const field = 'touch-target w-full rounded-md border border-[var(--border)] px-3';
  const heading = 'mb-3 text-sm font-semibold';

  return (
    <main className="mx-auto max-w-2xl p-4" data-testid="profile-page">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/chat" className="touch-target rounded-md border border-[var(--border)] px-3"
          data-testid="back-to-chat" aria-label={dict.back}>
          ←
        </Link>
        <Avatar userId={me.user.id} name={label} size={44} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold"><bdi dir="auto">{label}</bdi></h1>
          {/* force-ltr: an email must never reorder inside an RTL heading. */}
          <p className="force-ltr truncate text-sm text-[var(--muted)]">{me.user.email}</p>
        </div>
      </header>

      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          data-testid="profile-status"
          className={`mb-4 rounded-md p-3 text-sm ${
            status.kind === 'error' ? 'bg-[var(--danger-bg,#FCEBEB)] text-[var(--danger)]' : 'bg-[var(--surface)]'
          }`}
        >
          {status.text}
        </p>
      )}

      <section className={card}>
        <h2 className={heading}>{dict.yourDetails}</h2>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block">{dict.displayName}</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            dir="auto" maxLength={80} className={field} data-testid="display-name-input" />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block">{dict.displayNameAr}</span>
          {/* dir="rtl" not "auto": this field is FOR Arabic, so it should read
              right-to-left from the first keystroke rather than flipping. */}
          <input value={displayNameAr} onChange={(e) => setDisplayNameAr(e.target.value)}
            dir="rtl" maxLength={80} placeholder="محمد الأحمد"
            className={field} data-testid="display-name-ar-input" />
          <span className="mt-1 block text-xs text-[var(--muted)]">{dict.displayNameArHelp}</span>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block">{dict.language}</span>
          <select value={prefLocale} onChange={(e) => setPrefLocale(e.target.value as 'en' | 'ar')}
            className={field} data-testid="locale-select">
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <span className="mt-1 block text-xs text-[var(--muted)]">{dict.languageHelp}</span>
        </label>

        <div className="mb-4">
          <span className="mb-2 block text-sm">{dict.theme}</span>
          <ThemeToggle dict={dict} value={theme} onChange={setTheme} />
          <span className="mt-1 block text-xs text-[var(--muted)]">{dict.themeHelp}</span>
        </div>

        <button type="button" onClick={saveProfile} disabled={busy || !displayName.trim()}
          data-testid="save-profile"
          className="touch-target rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)] disabled:opacity-50">
          {dict.save}
        </button>
      </section>

      <section className={card}>
        <h2 className={heading}>{dict.changePassword}</h2>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block">{dict.currentPassword}</span>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password" className={field} data-testid="current-password-input" />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block">{dict.newPassword}</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password" className={field} data-testid="new-password-input" />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block">{dict.confirmPassword}</span>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password" className={field} data-testid="confirm-password-input" />
        </label>

        <p className="mb-3 text-xs text-[var(--muted)]">{dict.passwordChangeSignsOut}</p>

        <button type="button" onClick={changePassword}
          disabled={busy || !currentPassword || newPassword.length < 12}
          data-testid="submit-password"
          className="touch-target rounded-md border border-[var(--border)] px-4 font-medium disabled:opacity-50">
          {dict.changePassword}
        </button>
      </section>

      <section className={card}>
        <h2 className={heading}>{dict.security}</h2>

        <p className="mb-2 flex items-center justify-between text-sm">
          <span>{dict.twoFactor}</span>
          <span data-testid="totp-status" data-enabled={me.totpEnabled}
            className={me.totpEnabled ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}>
            {me.totpEnabled ? dict.enabled : dict.notEnabled}
          </span>
        </p>

        <p className="mb-4 flex items-center justify-between text-sm">
          <span>{dict.notificationDevices}</span>
          <span className="force-ltr">{me.pushDevices}</span>
        </p>

        <h3 className="mb-2 text-sm font-medium">{dict.activeSessions}</h3>
        <ul className="mb-3" data-testid="session-list">
          {sessions.map((s) => (
            <li key={s.id} data-testid="session-row" data-current={s.isCurrent}
              className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-2 text-sm last:border-0">
              <span className="min-w-0">
                <span className="block truncate">
                  {s.device}
                  {s.isCurrent && (
                    <span className="ms-2 rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs">
                      {dict.thisDevice}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-[var(--muted)]">
                  <bdi dir="auto">{formatDateTime(new Date(s.lastSeenAt), locale)}</bdi>
                  {s.ipAddress && <span className="force-ltr ms-2">{s.ipAddress}</span>}
                  {s.twoFactor && <span className="ms-2">🔐</span>}
                </span>
              </span>

              {!s.isCurrent && (
                <button type="button" onClick={() => revokeSessions(s.id)} disabled={busy}
                  data-testid={`revoke-${s.id}`} aria-label={`${dict.signOutDevice}: ${s.device}`}
                  className="touch-target shrink-0 rounded-md border border-[var(--border)] px-3 text-xs">
                  {dict.signOutDevice}
                </button>
              )}
            </li>
          ))}
        </ul>

        {sessions.length > 1 && (
          <button type="button" onClick={() => revokeSessions()} disabled={busy}
            data-testid="revoke-all-others"
            className="touch-target rounded-md border border-[var(--danger)] px-4 text-sm text-[var(--danger)]">
            {dict.signOutEverywhereElse}
          </button>
        )}
      </section>

      <section className={card}>
        <h2 className={heading}>{dict.storage}</h2>
        <p className="mb-2 text-sm">
          <span className="force-ltr">{formatBytes(me.storage.usedBytes)}</span>
          {' / '}
          <span className="force-ltr">{formatBytes(me.storage.quotaBytes)}</span>
          <span className="ms-2 text-[var(--muted)]">({me.storage.fileCount} {dict.files})</span>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface)]"
          role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
          aria-label={dict.storage} data-testid="storage-bar" data-percent={pct}>
          <div className="h-full rounded-full"
            style={{ width: `${pct}%`, background: pct > 90 ? 'var(--danger)' : 'var(--accent)' }} />
        </div>
      </section>

      <form action="/api/auth/logout" method="post">
        <button type="submit" data-testid="logout-button"
          className="touch-target w-full rounded-md border border-[var(--border)] px-4 font-medium">
          {dict.logout}
        </button>
      </form>
    </main>
  );
}
