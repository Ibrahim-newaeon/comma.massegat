'use client';
// src/components/chat/Avatar.tsx

/**
 * Colour is derived from the user id, so a person keeps the same colour
 * everywhere and across reloads. Random or index-based colours would shuffle
 * whenever the member list changed.
 */
/**
 * Stops along the brand's own arc — magenta through crimson and orange to
 * gold — rather than an arbitrary rainbow. Seven avatars in a row still read
 * as one identity.
 *
 * Solid fill with WHITE initials, not a light tint with dark text. A pale
 * pill glows against the dark aubergine surface; a saturated disc sits
 * correctly on both themes without needing a theme-aware variant.
 *
 * Every entry clears 4.5:1 against white.
 */
const PALETTE = [
  { bg: '#B5177A', fg: '#FFFFFF' },
  { bg: '#C42340', fg: '#FFFFFF' },
  { bg: '#B84E15', fg: '#FFFFFF' },
  { bg: '#8A6206', fg: '#FFFFFF' },
  { bg: '#7A2E8F', fg: '#FFFFFF' },
  { bg: '#A81E5C', fg: '#FFFFFF' },
  { bg: '#8F4A0E', fg: '#FFFFFF' },
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Two initials. Arabic has no case, so toUpperCase is a no-op there rather
 * than producing something wrong — safe to apply unconditionally.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  userId, name, size = 32, online,
}: {
  userId: string;
  name: string;
  size?: number;
  /** undefined hides the dot entirely — absent is not the same as offline. */
  online?: boolean;
}) {
  const colour = PALETTE[hashCode(userId) % PALETTE.length]!;

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
          // inset-inline-end so the dot stays on the outer corner in RTL.
          className={`absolute inset-block-end-0 inset-inline-end-0 block rounded-full ring-2 ring-[var(--bg)] ${
            online ? 'bg-green-500' : 'bg-[var(--border)]'
          }`}
          style={{ width: Math.round(size * 0.28), height: Math.round(size * 0.28) }}
        />
      )}
    </span>
  );
}
