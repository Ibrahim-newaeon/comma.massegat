'use client';
// src/app/change-password/ChangePasswordForm.tsx
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, ApiError } from '@/lib/csrfClient';
import type { Dict } from '@/lib/i18n/dict';

export function ChangePasswordForm({
  dict,
  setupToken,
  hasSession,
}: {
  dict: Dict;
  setupToken: string | null;
  hasSession: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsCurrent = !setupToken && hasSession;

  async function handleSubmit() {
    if (next !== confirm) {
      setError(dict.passwordsDoNotMatch);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiPost('/api/auth/change-password', {
        newPassword: next,
        ...(setupToken ? { setupToken } : { currentPassword: current }),
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : dict.error);
    } finally {
      setLoading(false);
    }
  }

  const field = 'force-ltr touch-target w-full rounded-md border border-[var(--border)] px-3';

  return (
    <div className="space-y-4" data-testid="change-password-form">
      {needsCurrent && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{dict.password}</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
            data-testid="current-password-input" autoComplete="current-password" dir="ltr" className={field} />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{dict.newPassword}</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
          data-testid="new-password-input" autoComplete="new-password" dir="ltr" className={field} />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{dict.confirmPassword}</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          data-testid="confirm-password-input" autoComplete="new-password" dir="ltr" className={field} />
      </label>

      {error && (
        <p role="alert" data-testid="change-password-error" className="text-sm text-[var(--danger)]">{error}</p>
      )}

      <button type="button" onClick={handleSubmit} disabled={loading || !next || !confirm}
        data-testid="change-password-submit"
        className="touch-target w-full rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)] disabled:opacity-50">
        {loading ? dict.loading : dict.changePassword}
      </button>
    </div>
  );
}
