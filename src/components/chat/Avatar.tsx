'use client';
// src/components/chat/Avatar.tsx

import { PALETTE, paletteIndexFor, initials } from '@/lib/ui/senderColor';

// Re-exported so existing imports from this module keep resolving.
export { colorForUser, PALETTE_SIZE } from '@/lib/ui/senderColor';

export function Avatar({
  userId, name, size = 32, online, colorIndex,
}: {
  userId: string;
  name: string;
  size?: number;
  /** undefined hides the dot entirely - absent is not the same as offline. */
  online?: boolean;
  /** Admin-assigned palette index. Null or omitted falls back to the hash. */
  colorIndex?: number | null;
}) {
  const colour = PALETTE[paletteIndexFor(userId, colorIndex)]!;

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        data-testid={`avatar-${userId}`}
        className="flex h-full w-full items-center justify-center rounded-full font-medium"
        style={{ background: colour.bg, color: colour.fg, fontSize: Math.round(size * 0.38) }}
      >
        {/* <bdi> stops a mixed-script name reordering its own initials. */}
        <bdi>{initials(name)}</bdi>
      </span>

      {online !== undefined && (
        <span
          aria-hidden
          data-testid={`avatar-presence-${userId}`}
          className={`absolute inset-block-end-0 inset-inline-end-0 block rounded-full ring-2 ring-[var(--bg)] ${
            online ? 'bg-green-500' : 'bg-[var(--border)]'
          }`}
          style={{ width: Math.round(size * 0.28), height: Math.round(size * 0.28) }}
        />
      )}
    </span>
  );
}
