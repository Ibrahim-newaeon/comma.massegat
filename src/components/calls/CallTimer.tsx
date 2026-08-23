'use client';
// src/components/calls/CallTimer.tsx
import { useEffect, useRef, useState } from 'react';

/**
 * Elapsed call time.
 *
 * Anchored to a startedAt timestamp rather than counting ticks: a setInterval
 * that increments a counter drifts, and browsers throttle timers in background
 * tabs — a call left in another tab for ten minutes would come back showing
 * two. Recomputing from the anchor each tick is always correct.
 */
export function CallTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  const anchor = useRef(startedAt);

  useEffect(() => {
    anchor.current = startedAt;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - anchor.current) / 1000)));
    tick();
    const id = setInterval(tick, 1000);

    // A background tab stops painting; recompute the moment it returns.
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [startedAt]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;

  const label = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  return (
    <time
      // Always LTR: a duration is not directional text, and 12:05 must not
      // render as 05:12 in an RTL layout.
      dir="ltr"
      className="force-ltr tabular-nums"
      data-testid="call-timer"
      data-elapsed-seconds={elapsed}
      aria-label={`Call duration ${label}`}
    >
      {label}
    </time>
  );
}
