'use client';
// src/components/admin/InviteDialog.tsx
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Dict, Locale } from '@/lib/i18n/dict';
import { formatDateTime } from '@/lib/i18n/dict';

/**
 * Shows a one-time setup link, with a QR code.
 *
 * The QR matters more than it looks: most people set the app up on a phone,
 * and typing a 43-character token by hand is where an onboarding fails.
 */
export function InviteDialog({
  dict, locale, setupUrl, expiresAt, displayName, email, isReset, onClose,
}: {
  dict: Dict;
  locale: Locale;
  setupUrl: string;
  expiresAt: string;
  displayName: string;
  email: string;
  isReset: boolean;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    // Rendered locally. Sending the URL to a QR service would hand a live
    // credential to a third party.
    void QRCode.toCanvas(canvas.current, setupUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
  }, [setupUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(setupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context. On plain HTTP it throws, so
      // the URL stays selectable as a fallback rather than silently failing.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dict.invitationLink}
        data-testid="invite-dialog"
        className="w-full max-w-md rounded-xl bg-[var(--bg)] p-5 shadow-xl"
      >
        <h2 className="mb-1 text-base font-semibold">
          {isReset ? dict.passwordResetLink : dict.invitationLink}
        </h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          <bdi dir="auto">{displayName}</bdi>
          <span className="force-ltr ms-2">{email}</span>
        </p>

        <div className="mb-4 flex justify-center rounded-lg bg-white p-3">
          <canvas ref={canvas} data-testid="invite-qr" aria-label={dict.scanToOpen} />
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-[var(--muted)]">{dict.orCopyLink}</span>
          <input
            readOnly
            value={setupUrl}
            onFocus={(e) => e.currentTarget.select()}
            // force-ltr: a URL inside an RTL layout reorders and becomes
            // unusable when copied by eye.
            className="force-ltr w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
            data-testid="invite-url"
          />
        </label>

        <p className="mb-4 text-xs text-[var(--muted)]" data-testid="invite-expiry">
          {dict.linkExpires} {formatDateTime(new Date(expiresAt), locale)}
        </p>

        <p className="mb-4 rounded-lg bg-[var(--warning-subtle)] p-3 text-xs text-[var(--warning)]">
          {dict.inviteWarning}
        </p>

        <div className="flex gap-2">
          <button type="button" onClick={copy} data-testid="copy-invite"
            className="touch-target flex-1 rounded-lg bg-[var(--accent)] font-medium text-[var(--accent-on)]">
            {copied ? dict.copied : dict.copyLink}
          </button>
          <button type="button" onClick={onClose} data-testid="close-invite"
            className="touch-target rounded-lg border border-[var(--border)] px-4">
            {dict.close}
          </button>
        </div>
      </div>
    </div>
  );
}
