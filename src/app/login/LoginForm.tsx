'use client';
// src/app/login/LoginForm.tsx
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, ApiError } from '@/lib/csrfClient';
import type { Dict } from '@/lib/i18n/dict';

type LoginResult = {
  role: string;
  mustChangePassword: boolean;
  totpEnrolmentRequired: boolean;
};

export function LoginForm({ dict }: { dict: Dict }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<LoginResult>('/api/auth/login', {
        email,
        password,
        ...(needsTotp ? { totpCode } : {}),
      });
      if (data.mustChangePassword) router.push('/change-password');
      else if (data.totpEnrolmentRequired) router.push('/setup-2fa');
      else router.push('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError(null);
      } else if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setError(dict.accountLocked);
      } else if (err instanceof ApiError && err.code === 'INVALID_TOTP') {
        setError(err.message);
      } else {
        // Generic — never disclose whether the account exists.
        setError(dict.invalidCredentials);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="login-form">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{dict.email}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          data-testid="email-input"
          autoComplete="username"
          dir="ltr"
          className="force-ltr touch-target w-full rounded-md border border-[var(--border)] px-3"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{dict.password}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          data-testid="password-input"
          autoComplete="current-password"
          dir="ltr"
          className="force-ltr touch-target w-full rounded-md border border-[var(--border)] px-3"
        />
      </label>

      {needsTotp && (
        <label className="block" data-testid="totp-field">
          <span className="mb-1 block text-sm font-medium">{dict.totpCode}</span>
          <span className="mb-1 block text-xs text-[var(--muted)]">{dict.totpPrompt}</span>
          <input
            inputMode="numeric"
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            data-testid="totp-input"
            autoComplete="one-time-code"
            dir="ltr"
            className="force-ltr touch-target w-full rounded-md border border-[var(--border)] px-3 tracking-[0.4em]"
          />
        </label>
      )}

      {error && (
        <p role="alert" data-testid="login-error" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !email || !password}
        data-testid="login-submit"
        className="touch-target w-full rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)] disabled:opacity-50"
      >
        {loading ? dict.loading : dict.signIn}
      </button>
    </div>
  );
}
