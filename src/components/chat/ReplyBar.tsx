'use client';
// src/components/chat/ReplyBar.tsx
import type { Dict, Locale } from '@/lib/i18n/dict';
import type { MessageDTO } from '@/lib/chat/types';

/**
 * Sits above the composer while a reply is being written.
 *
 * Without it the reply target is invisible once you start typing, and people
 * send replies attached to the wrong message — which is worse than no reply
 * feature, because the quote asserts a connection that isn't there.
 */
export function ReplyBar({
  target, locale, dict, onCancel,
}: {
  target: MessageDTO;
  locale: Locale;
  dict: Dict;
  onCancel: () => void;
}) {
  const name = locale === 'ar' && target.senderNameAr ? target.senderNameAr : target.senderName;
  const text = target.body?.trim()
    ? target.body
    : target.attachments?.length ? `📎 ${dict.attachment}` : '';

  return (
    <div
      data-testid="reply-bar"
      className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2"
    >
      <span className="min-w-0 flex-1 border-s-2 border-[var(--accent)] ps-2">
        <span className="block text-[11px] text-[var(--muted)]">{dict.replyingTo}</span>
        <bdi dir="auto" className="block truncate text-xs font-medium">{name}</bdi>
        <bdi dir="auto" className="block truncate text-xs text-[var(--muted)]">{text}</bdi>
      </span>

      <button
        type="button"
        onClick={onCancel}
        data-testid="cancel-reply"
        aria-label={dict.cancelReply}
        className="touch-target shrink-0 rounded-lg border border-[var(--border)] px-3 text-sm"
      >
        ✕
      </button>
    </div>
  );
}
