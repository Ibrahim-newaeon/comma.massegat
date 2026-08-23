'use client';
// src/app/signup/SignupForm.tsx
import { useState } from 'react';
import Link from 'next/link';
import type { Dict } from '@/lib/i18n/dict';

export function SignupForm({
  dict, domains, needsApproval,
}: {
  dict: Dict;
  domains: string[];
  needsApproval: boolean;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayNameAr, setDisplayNameAr] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (password !== confirm) { setError(dict.passwordsDoNotMatch); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim(),
          displayNameAr: displayNameAr.trim() || undefined,
          password,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error?.message ?? dict.error); return; }
      setDone(true);
    } catch {
      setError(dict.error);
    } finally {
      setBusy(false);
    }
  }

  const field = 'touch-target w-full rounded-lg border border-[var(--border)] px-3';

  if (done) {
    return (
      <main className="mx-auto max-w-sm p-6" data-testid="signup-done">
        <h1 className="mb-3 text-lg font-semibold">{dict.registered}</h1>
        <p className="mb-6 text-sm text-[var(--muted)]">
          {needsApproval ? dict.registeredPending : dict.registeredReady}
        </p>
        <Link href="/login" data-testid="to-login"
          className="touch-target inline-flex items-center rounded-lg bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)]">
          {dict.signIn}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6" data-testid="signup-page">
      <h1 className="mb-1 text-lg font-semibold">{dict.createAccount}</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        {/* Stated up front. Discovering the restriction only after filling in
            four fields is the worst version of this. */}
        {dict.signupDomainNote} <span className="force-ltr">{domains.map((d) => `@${d}`).join(', ')}</span>
      </p>

      {error && (
        <p role="alert" data-testid="signup-error"
          className="mb-4 rounded-lg bg-[var(--danger-subtle)] p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <label className="mb-3 block text-sm">
        <span className="mb-1 block">{dict.email}</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          dir="ltr" autoComplete="email" className={`force-ltr ${field}`} data-testid="signup-email" />
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block">{dict.displayName}</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          dir="auto" maxLength={80} className={field} data-testid="signup-name" />
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block">{dict.displayNameAr}</span>
        <input value={displayNameAr} onChange={(e) => setDisplayNameAr(e.target.value)}
          dir="rtl" maxLength={80} placeholder="محمد الأحمد" className={field} data-testid="signup-name-ar" />
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block">{dict.newPassword}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" className={field} data-testid="signup-password" />
      </label>

      <label className="mb-5 block text-sm">
        <span className="mb-1 block">{dict.confirmPassword}</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" className={field} data-testid="signup-confirm" />
      </label>

      <button type="button" onClick={submit}
        disabled={busy || !email.trim() || !displayName.trim() || password.length < 12}
        data-testid="signup-submit"
        className="touch-target w-full rounded-lg bg-[var(--accent)] font-medium text-[var(--accent-on)] disabled:opacity-50">
        {dict.createAccount}
      </button>

      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-[var(--accent)]">{dict.haveAccount}</Link>
      </p>
    </main>
  );
}
