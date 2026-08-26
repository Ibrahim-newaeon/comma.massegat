// src/lib/ui/senderColor.ts

/**
 * Stops along the brand's own arc - magenta through crimson and orange to
 * gold - rather than an arbitrary rainbow. Seven avatars in a row still read
 * as one identity. Every entry clears 4.5:1 against white.
 *
 * Lives here rather than in Avatar.tsx because route handlers validate against
 * PALETTE_SIZE, and a 'use client' module must not be imported server-side.
 */
export const PALETTE = [
  { bg: '#B5177A', fg: '#FFFFFF' },
  { bg: '#C42340', fg: '#FFFFFF' },
  { bg: '#B84E15', fg: '#FFFFFF' },
  { bg: '#8A6206', fg: '#FFFFFF' },
  { bg: '#7A2E8F', fg: '#FFFFFF' },
  { bg: '#A81E5C', fg: '#FFFFFF' },
  { bg: '#8F4A0E', fg: '#FFFFFF' },
] as const;

export const PALETTE_SIZE = PALETTE.length;

export function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Explicit admin choice wins; otherwise derive from the id so a person keeps
 *  the same colour everywhere and across reloads. */
export function paletteIndexFor(userId: string, colorIndex?: number | null): number {
  return (colorIndex != null && Number.isInteger(colorIndex) &&
          colorIndex >= 0 && colorIndex < PALETTE_SIZE)
    ? colorIndex
    : hashCode(userId) % PALETTE_SIZE;
}

export function colorForUser(userId: string, colorIndex?: number | null): string {
  return PALETTE[paletteIndexFor(userId, colorIndex)]!.bg;
}

/** Two initials. Arabic has no case, so toUpperCase is a no-op there rather
 *  than producing something wrong - safe to apply unconditionally. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
