'use client';
// src/app/setup-2fa/TotpEnroll.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, ApiError } from '@/lib/csrfClient';
import type { Dict } from '@/lib/i18n/dict';

export function TotpEnroll({ dict }: { dict: Dict }) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiPost<{ qrDataUrl: string; secret: string }>('/api/auth/totp/enroll', {})
      .then((d) => { setQr(d.qrDataUrl); setSecret(d.secret); })
      .catch((e) => setError(e instanceof ApiError ? e.message : dict.error))
      .finally(() => setLoading(false));
  }, [dict.error]);

  async function verify() {
    setError(null);
    try {
      await apiPost('/api/auth/totp/verify', { code });
      router.push('/admin/users');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : dict.error);
    }
  }

  if (loading) return <p data-testid="totp-loading">{dict.loading}</p>;

  return (
    <div className="space-y-4" data-testid="totp-enroll">
      {/* A data: URI. next/image would proxy it through the optimizer for no
          benefit, and the TOTP secret would pass through another layer on the
          way. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && <img src={qr} alt="TOTP QR code" width={200} height={200} data-testid="totp-qr" />}
      {secret && (
        <p className="text-xs text-[var(--muted)]">
          Manual key: <code className="force-ltr" data-testid="totp-secret">{secret}</code>
        </p>
      )}
      <input inputMode="numeric" maxLength={6} value={code} dir="ltr"
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && verify()}
        data-testid="totp-verify-input" aria-label={dict.totpCode}
        className="force-ltr touch-target w-full rounded-md border border-[var(--border)] px-3 tracking-[0.4em]" />
      {error && <p role="alert" data-testid="totp-error" className="text-sm text-[var(--danger)]">{error}</p>}
      <button type="button" onClick={verify} disabled={code.length !== 6} data-testid="totp-verify-submit"
        className="touch-target w-full rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)] disabled:opacity-50">
        Verify
      </button>
    </div>
  );
}
