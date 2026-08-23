'use client';
// src/components/files/Waveform.tsx

/**
 * A representative waveform, not a real one.
 *
 * Decoding actual audio to draw peaks means downloading every voice note in a
 * channel on render — dozens of signed URLs and megabytes for decoration. The
 * bars are derived from the attachment id, so they are stable per note and
 * differ between notes, which is all the shape needs to convey: "this is
 * speech, and it is this long".
 */
function barsFor(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;

  return Array.from({ length: count }, () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    // 0.25 floor: a zero-height bar reads as a rendering fault, not silence.
    return 0.25 + ((h >> 8) % 100) / 100 * 0.75;
  });
}

export function Waveform({
  seed, progress = 0, bars = 28,
}: {
  seed: string;
  /** 0-1. Bars before this point are filled. */
  progress?: number;
  bars?: number;
}) {
  const heights = barsFor(seed, bars);
  const filled = Math.floor(progress * bars);

  return (
    <span
      aria-hidden
      data-testid="waveform"
      // Always LTR: a waveform maps to time, and time does not mirror.
      dir="ltr"
      className="flex h-6 items-center gap-[2px]"
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-[2px] shrink-0 rounded-full transition-colors"
          style={{
            height: `${Math.round(h * 100)}%`,
            background: i <= filled && progress > 0 ? 'var(--accent)' : 'var(--border-strong, #b4b2a9)',
          }}
        />
      ))}
    </span>
  );
}
