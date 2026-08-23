'use client';
// src/components/chat/Reactions.tsx
import { useState } from 'react';
import type { Dict } from '@/lib/i18n/dict';
import type { ReactionDTO } from '@/lib/chat/types';

/**
 * Six, not a full picker.
 *
 * A searchable emoji grid is a lot of interface for a feature whose whole
 * point is being faster than typing "noted". These six cover acknowledge,
 * agree, thanks, done, question, and celebrate — which is most of what a
 * work channel needs.
 */
const QUICK = ['👍', '✅', '❤️', '😄', '🙏', '👀'];

export function Reactions({
  reactions, meId, dict, onToggle,
}: {
  reactions: ReactionDTO[];
  meId: string;
  dict: Dict;
  onToggle: (emoji: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1" data-testid="reactions">
      {reactions.map((r) => {
        // Derived here, not sent by the server — see ReactionDTO.
        const mine = r.userIds.includes(meId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            data-testid={`reaction-${r.emoji}`}
            data-mine={mine}
            title={r.names.join(', ')}
            aria-label={`${r.emoji} ${r.count}`}
            aria-pressed={mine}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              mine
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)] font-medium'
                : 'border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            <span aria-hidden>{r.emoji}</span>
            {/* force-ltr: a count beside an emoji inside an RTL bubble
                otherwise renders on the wrong side of it. */}
            <span className="force-ltr">{r.count}</span>
          </button>
        );
      })}

      <span className="relative">
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          data-testid="add-reaction"
          aria-label={dict.addReaction}
          aria-expanded={picking}
          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
        >
          ☺+
        </button>

        {picking && (
          <>
            {/* Full-screen catcher: without it the picker stays open when the
                user taps elsewhere, and on a phone there is no obvious way to
                dismiss it. */}
            <span
              className="fixed inset-0 z-10"
              onClick={() => setPicking(false)}
              aria-hidden
            />
            <span
              role="menu"
              data-testid="reaction-picker"
              className="absolute bottom-7 z-20 flex gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] p-1 shadow-lg ltr:left-0 rtl:right-0"
            >
              {QUICK.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitem"
                  onClick={() => { onToggle(e); setPicking(false); }}
                  data-testid={`pick-${e}`}
                  aria-label={e}
                  className="rounded-full px-1.5 py-0.5 text-base hover:bg-[var(--surface)]"
                >
                  {e}
                </button>
              ))}
            </span>
          </>
        )}
      </span>
    </span>
  );
}
