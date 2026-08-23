'use client';
// src/components/chat/ReplyQuote.tsx
import type { Dict, Locale } from '@/lib/i18n/dict';
import type { ReplyPreviewDTO } from '@/lib/chat/types';

/**
 * The quoted original, shown above a reply.
 *
 * Clickable: tapping scrolls to the original. A quote you cannot navigate from
 * is a dead end — the reader still has to hunt for context, which is the
 * problem replies exist to solve.
 */
export function ReplyQuote({
  reply, locale, dict, onJump,
}: {
  reply: ReplyPreviewDTO;
  locale: Locale;
  dict: Dict;
  onJump?: (messageId: string) => void;
}) {
  const name = locale === 'ar' && reply.senderNameAr ? reply.senderNameAr : reply.senderName;

  const text = reply.deleted
    ? dict.messageDeleted
    : reply.body?.trim()
      ? reply.body
      : reply.hasAttachments ? `📎 ${dict.attachment}` : '';

  return (
    <button
      type="button"
      onClick={() => !reply.deleted && onJump?.(reply.id)}
      disabled={reply.deleted}
      data-testid="reply-quote"
      data-deleted={reply.deleted}
      className="mb-1 flex w-full flex-col rounded-md bg-black/5 px-2 py-1 text-start disabled:cursor-default"
    >
      {/* border-s: logical, so it sits on the leading edge in both directions.
          border-l would be on the wrong side of an Arabic quote. */}
      <span className="border-s-2 border-[var(--accent)] ps-2">
        <bdi dir="auto" className="block text-[11px] font-semibold text-[var(--accent-strong)]">
          {name}
        </bdi>
        <bdi
          dir="auto"
          className={`block truncate text-[11px] ${
            reply.deleted ? 'italic opacity-60' : 'opacity-80'
          }`}
        >
          {text}
        </bdi>
      </span>
    </button>
  );
}
