'use client';
// src/components/chat/SystemNotice.tsx
import type { MessageDTO } from '@/lib/chat/types';
import { formatDateTime, type Dict, type Locale } from '@/lib/i18n/dict';

function formatDuration(seconds: number, dict: Dict): string {
  if (seconds < 60) return `${seconds}${dict.secondsShort}`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} ${dict.minutesShort}`;
  return `${Math.floor(m / 60)}${dict.hoursShort} ${m % 60}${dict.minutesShort}`;
}

/**
 * Centred notice, not a bubble. A system message has no "side" — it belongs to
 * the conversation rather than to a participant, so it must not be styled as
 * though someone said it.
 */
export function SystemNotice({
  message, dict, locale,
}: {
  message: MessageDTO;
  dict: Dict;
  locale: Locale;
}) {
  const data = message.systemData;

  const text = data?.type === 'call_ended'
    ? `${dict.callEnded} · ${data.participantCount} ${
        data.participantCount === 1 ? dict.participantOne : dict.participantMany
      } · ${formatDuration(data.durationSeconds, dict)}`
    : (message.body ?? '');

  return (
    <div className="my-3 flex items-center gap-3" data-testid="system-notice"
         data-system-type={data?.type ?? 'unknown'}>
      <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
      <span
        // dir="auto" so an Arabic notice reads correctly in an English UI
        dir="auto"
        className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted)]"
      >
        <span aria-hidden>📞</span>
        <bdi>{text}</bdi>
        <time dateTime={message.createdAt} className="opacity-70">
          {formatDateTime(new Date(message.createdAt), locale)}
        </time>
      </span>
      <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
    </div>
  );
}
