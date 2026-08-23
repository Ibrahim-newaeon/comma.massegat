'use client';
// src/components/chat/MessageBubble.tsx
import { useMemo } from 'react';
import type { MessageDTO } from '@/lib/chat/types';
import { AttachmentChip } from '@/components/files/AttachmentChip';
import { Reactions } from '@/components/chat/Reactions';
import { ReplyQuote } from '@/components/chat/ReplyQuote';
import { Avatar } from '@/components/chat/Avatar';
import { formatDateTime, type Locale, type Dict } from '@/lib/i18n/dict';

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

  return (
    <div
      // Bubble ALIGNMENT — driven by ownership, resolved via logical properties
      // so it mirrors correctly in RTL. Not driven by text direction.
      className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} ${showSender ? 'mt-3' : 'mt-0.5'}`}
      data-testid="message-row"
      data-own={isOwn}
      data-grouped={!showSender}
    >
      {/* Avatar column. On a grouped message the space is RESERVED but empty —
          removing it would make consecutive messages jump left and right. */}
      <span className="w-8 shrink-0">
        {showSender && !isOwn && (
          <Avatar userId={message.senderId} name={senderLabel} size={32} />
        )}
      </span>

      <div className={`flex min-w-0 flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
      {showSender && !isOwn && (
        <span className="mb-0.5 px-1 text-xs text-[var(--muted)]" data-testid="message-sender">
          {/* <bdi> isolates the name so a mixed-script name cannot reorder
              surrounding characters. */}
          <bdi dir="auto">{senderLabel}</bdi>
        </span>
      )}

      <div
        className={`group relative max-w-[75%] rounded-lg px-3 py-2 ${
          isOwn ? 'bubble-own' : 'bubble-other'
        } ${isPending ? 'opacity-60' : ''}`}
      >
        {message.replyTo && (
          <ReplyQuote reply={message.replyTo} locale={locale} dict={dict} onJump={onJump} />
        )}

        {message.deletedAt ? (
          <span className="text-sm italic opacity-70" data-testid="message-deleted">
            {dict.messageDeleted}
          </span>
        ) : (
          <div
            // CONTENT direction — decided per message by the browser's bidi
            // algorithm. NEVER inherited from the app shell.
            dir="auto"
            data-testid="message-body"
            data-message-id={message.id}
            data-seq={message.seq}
            className="whitespace-pre-wrap break-words text-sm"
          >
            {content}
          </div>
        )}

        {message.attachments?.length > 0 && (
          <div data-testid="message-attachments">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} dict={dict} />
            ))}
          </div>
        )}

        <div className="mt-1 flex items-center gap-2 text-[10px] opacity-70">
          <time dateTime={message.createdAt} data-testid="message-time">
            {formatDateTime(new Date(message.createdAt), locale)}
          </time>
          {message.editedAt && <span data-testid="message-edited">{dict.edited}</span>}
          {isPending && <span data-testid="message-pending">{dict.sending}</span>}
        </div>

        {/* Not on a tombstone, and not while the message is still unsent —
            reacting to something the server has never seen has nothing to
            attach to. */}
        {!message.deletedAt && !isPending && onReact && (
          <Reactions
            reactions={message.reactions ?? []}
            meId={meId}
            dict={dict}
            onToggle={(emoji) => onReact(message.id, emoji)}
          />
        )}

        {/* Sits beside delete, revealed on hover like it. On touch there is
            no hover, so both stay visible below md — a control you cannot
            reach on a phone is not a control. */}
        {onReply && !message.deletedAt && !isPending && (
          <button
            type="button"
            onClick={() => onReply(message)}
            data-testid={`reply-to-message-${message.id}`}
            aria-label={dict.reply}
            title={dict.reply}
            className="absolute -top-2 end-9 rounded px-2 py-1 text-xs max-md:block md:hidden md:group-hover:block"
          >
            ↩
          </button>
        )}

        {canDelete && !message.deletedAt && !isPending && (
          <button
            type="button"
            onClick={() => onDelete?.(message.id)}
            data-testid={`delete-message-${message.id}`}
            aria-label={dict.deleteMessage}
            // Logical positioning — mirrors automatically in RTL.
            className="absolute -top-2 end-1 rounded px-2 py-1 text-xs max-md:block md:hidden md:group-hover:block"
          >
            ✕
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
