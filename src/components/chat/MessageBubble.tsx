'use client';
// src/components/chat/MessageBubble.tsx
import { useMemo } from 'react';
import type { MessageDTO } from '@/lib/chat/types';
import { AttachmentChip } from '@/components/files/AttachmentChip';
import { Reactions } from '@/components/chat/Reactions';
import { ReplyQuote } from '@/components/chat/ReplyQuote';
import type { CSSProperties } from 'react';
import { Avatar, colorForUser } from '@/components/chat/Avatar';
import type { Locale, Dict } from '@/lib/i18n/dict';

/**
 * TWO INDEPENDENT AXES — conflating them is the most common RTL bug.
 *
 *   1. Which SIDE the bubble sits on  → is it my message?  (UI direction)
 *   2. Which DIRECTION the text runs  → the message content (dir="auto")
 *
 * An Arabic-locale user sending an English message gets the bubble on the
 * RTL "own" side with LTR text inside it. Both are correct at once.
 */

// Segments that must render LTR even inside an Arabic message.
const LTR_PATTERN =
  /(https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s()-]{6,}\d|[A-Za-z]:\\[^\s]+|\/[\w./-]+)/g;

function renderWithLtrSegments(text: string) {
  const parts = text.split(LTR_PATTERN);
  return parts.map((part, i) => {
    if (!part) return null;
    LTR_PATTERN.lastIndex = 0;
    const isLtrSegment = LTR_PATTERN.test(part);
    LTR_PATTERN.lastIndex = 0;
    return isLtrSegment ? (
      <span key={i} className="force-ltr" data-testid="ltr-segment">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

export function MessageBubble({
  message, isOwn, locale, dict, showSender, onDelete, canDelete, meId, onReact,
  onReply, onJump,
}: {
  message: MessageDTO;
  isOwn: boolean;
  locale: Locale;
  dict: Dict;
  showSender: boolean;
  onDelete?: (id: string) => void;
  canDelete: boolean;
  meId: string;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: MessageDTO) => void;
  /** Scrolls to the quoted original. */
  onJump?: (messageId: string) => void;
}) {
  const senderLabel = locale === 'ar' && message.senderNameAr
    ? message.senderNameAr
    : message.senderName;

  const content = useMemo(
    () => (message.body ? renderWithLtrSegments(message.body) : null),
    [message.body],
  );

  const isPending = message.seq === '0';

  /** Stable per-sender colour, from the same palette the avatar uses. */
  const senderColor = colorForUser(message.senderId);

  /** Clock only — the day is carried by a separator, not repeated per row. */
  const clock = new Date(message.createdAt).toLocaleTimeString(
    locale === 'ar' ? 'ar' : 'en-GB',
    { hour: '2-digit', minute: '2-digit' },
  );

  return (
    <article
      /**
       * A two-column grid, not a bubble row.
       *
       * Column one is a fixed time gutter on the direction-neutral edge, so a
       * timestamp never reorders against the message it belongs to. In a
       * bubble layout the time sits INSIDE the RTL run and jumps sides.
       *
       * Column two is the message itself, set as text on the page rather than
       * inside a tinted pill. Bubbles fight bidirectional text: the tail
       * points the wrong way and the padding is asymmetric in the wrong
       * direction.
       */
      className={`group relative grid grid-cols-[54px_1fr] py-0.5 ${
        showSender ? 'mt-4' : 'mt-0'
      }`}
      data-testid="message-row"
      data-own={isOwn}
      data-grouped={!showSender}
    >
      {/* Revealed on hover on desktop; always visible on touch, where there is
          no hover and an invisible timestamp is simply missing. */}
      <time
        suppressHydrationWarning
        dateTime={message.createdAt}
        data-testid="message-time"
        className="force-ltr pt-0.5 text-[11px] tabular-nums text-[var(--muted)] opacity-0 transition-opacity max-md:opacity-100 group-hover:opacity-100"
      >
        {clock}
      </time>

      <div
        className={`min-w-0 ${isPending ? 'opacity-60' : ''} ${
          /* Own messages carry a rule in the leading margin and the faintest
             tint — enough to distinguish sender without breaking the single
             column the eye reads down. */
          'msg-block border-s-2 border-[var(--sender-color)]'
        }`}
        data-message-id={message.id}
        data-seq={message.seq}
        style={{ '--sender-color': isOwn ? 'var(--accent)' : senderColor } as CSSProperties}
      >
        {showSender && (
          <div className="mb-0.5 flex items-center gap-2">
            {!isOwn && <Avatar userId={message.senderId} name={senderLabel} size={20} />}
            <span className="text-xs font-semibold text-[var(--muted)]" data-testid="message-sender">
              {/* <bdi> isolates the name so a mixed-script name cannot
                  reorder what surrounds it. */}
              <bdi dir="auto">{isOwn ? dict.you : senderLabel}</bdi>
            </span>
          </div>
        )}

        {message.replyTo && (
          <ReplyQuote reply={message.replyTo} locale={locale} dict={dict} onJump={onJump} />
        )}

        {message.deletedAt ? (
          <span className="text-sm italic text-[var(--muted)]" data-testid="message-deleted">
            {dict.messageDeleted}
          </span>
        ) : (
          <div
            // CONTENT direction — decided per message by the browser's bidi
            // algorithm. NEVER inherited from the app shell.
            dir="auto"
            data-testid="message-body"
            className="msg-text whitespace-pre-wrap break-words"
          >
            {content}
          </div>
        )}

        {message.attachments?.length > 0 && (
          <div data-testid="message-attachments" className="mt-1">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} dict={dict} />
            ))}
          </div>
        )}

        {(message.editedAt || isPending) && (
          <div className="mt-0.5 text-[10px] text-[var(--rubric,var(--highlight))]">
            {message.editedAt && <span data-testid="message-edited">{dict.edited}</span>}
            {isPending && <span data-testid="message-pending">{dict.sending}</span>}
          </div>
        )}

        {!message.deletedAt && !isPending && onReact && (
          <Reactions
            reactions={message.reactions ?? []}
            meId={meId}
            dict={dict}
            onToggle={(emoji) => onReact(message.id, emoji)}
          />
        )}
      </div>

      {/* Row actions, in the trailing margin. Hidden until hover on desktop;
          always present on touch, because a control you cannot reach on a
          phone is not a control. */}
      {!message.deletedAt && !isPending && (
        <div className="absolute end-0 top-0 flex gap-1 max-md:flex md:hidden md:group-hover:flex">
          {onReply && (
            <button
              type="button"
              onClick={() => onReply(message)}
              data-testid={`reply-to-message-${message.id}`}
              aria-label={dict.reply}
              title={dict.reply}
              className="rounded px-2 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
            >
              ↩
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete?.(message.id)}
              data-testid={`delete-message-${message.id}`}
              aria-label={dict.deleteMessage}
              className="rounded px-2 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </article>
  );
}
