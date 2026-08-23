'use client';
// src/components/calls/IncomingCall.tsx
import type { Dict } from '@/lib/i18n/dict';

export function IncomingCall({
  from, dict, onAccept, onDecline,
}: {
  from: string;
  dict: Dict;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.incomingCall}
      data-testid="incoming-call"
      className="fixed inset-inline-end-4 inset-block-start-4 z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 shadow-lg"
    >
      <p className="mb-1 text-sm font-medium">{dict.incomingCall}</p>
      <p className="mb-4 text-sm text-[var(--muted)]">
        <bdi dir="auto" data-testid="caller-name">{from}</bdi>
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onAccept} data-testid="accept-call"
          className="touch-target flex-1 rounded-md bg-[var(--accent)] font-medium text-[var(--accent-on)]">
          {dict.acceptCall}
        </button>
        <button type="button" onClick={onDecline} data-testid="decline-call"
          className="touch-target flex-1 rounded-md border border-[var(--border)]">
          {dict.declineCall}
        </button>
      </div>
    </div>
  );
}
