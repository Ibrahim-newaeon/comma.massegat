'use client';
// src/lib/chat/sound.ts
//
// Synthesised, not a shipped audio file: no asset to host, no CSP media-src to
// widen, no extra request, and the tone is tunable in code.

let ctx: AudioContext | null = null;

/**
 * Browsers block audio until the user has interacted with the page. Creating
 * the context lazily, on the first sound after an interaction, avoids a
 * console warning on every load and a context stuck in 'suspended'.
 */
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startAt: number, durationMs: number, volume: number) {
  const audio = audioContext();
  if (!audio) return;

  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'sine';                       // softer than square or sawtooth
  osc.frequency.value = freq;

  // Ramp in and out. A raw start/stop produces an audible click.
  const t = audio.currentTime + startAt;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);

  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + durationMs / 1000 + 0.02);
}

const KEY = 'cp_sound_enabled';

/**
 * Per-DEVICE on purpose: sound on at a desk, off on a phone in a meeting.
 * Storing this per-account would tie those together, which is not what anyone
 * wants. No session or auth state is involved, so the localStorage rule —
 * which exists to keep credentials out of client storage — does not apply.
 */
export function soundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line no-restricted-properties
  try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; }
}

export function setSoundEnabled(on: boolean) {
  // eslint-disable-next-line no-restricted-properties
  try { localStorage.setItem(KEY, on ? 'true' : 'false'); } catch { /* private mode */ }
}

/** Two rising notes. Short and quiet — this fires often in an open office. */
export function playMessageSound() {
  if (!soundEnabled()) return;
  tone(660, 0, 90, 0.06);
  tone(880, 0.09, 110, 0.05);
}

/**
 * Incoming call: a repeating three-note pattern, louder and longer, because it
 * needs to reach someone who is not looking at the screen.
 * Returns a stop function — a ring that outlives the call is worse than none.
 */
export function playRingtone(): () => void {
  if (!soundEnabled()) return () => {};

  const ring = () => {
    tone(587, 0, 200, 0.12);
    tone(740, 0.22, 200, 0.12);
    tone(880, 0.44, 320, 0.12);
  };

  ring();
  const id = setInterval(ring, 2400);
  return () => clearInterval(id);
}

/** Descending pair — reads as "ended" rather than "arrived". */
export function playCallEndSound() {
  if (!soundEnabled()) return;
  tone(660, 0, 120, 0.07);
  tone(440, 0.12, 180, 0.06);
}
