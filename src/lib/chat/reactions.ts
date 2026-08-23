// src/lib/chat/reactions.ts
import type { ReactionDTO } from '@/lib/chat/types';

type Row = { emoji: string; userId: string; user: { displayName: string } };

/**
 * Rows → grouped counts, viewer-independent.
 *
 * Shared by the REST list and the socket path. Two implementations would
 * drift, and the failure would be subtle: reactions ordered one way on load
 * and another after an update, with counts that look almost right.
 *
 * `userIds` ships instead of a server-computed `mine` so a broadcast can be
 * serialised once for everyone rather than once per recipient.
 */
export function groupReactions(rows: Row[]): ReactionDTO[] {
  const byEmoji = new Map<string, ReactionDTO>();

  for (const r of rows ?? []) {
    let g = byEmoji.get(r.emoji);
    if (!g) {
      g = { emoji: r.emoji, count: 0, userIds: [], names: [] };
      byEmoji.set(r.emoji, g);
    }
    g.count += 1;
    g.userIds.push(r.userId);
    // Capped: a tooltip listing forty names is unreadable, and the payload
    // grows with every reaction on a busy message.
    if (g.names.length < 8) g.names.push(r.user?.displayName ?? '');
  }

  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}
