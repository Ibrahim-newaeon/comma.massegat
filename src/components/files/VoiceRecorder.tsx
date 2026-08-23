'use client';
// src/components/files/VoiceRecorder.tsx
import { useEffect, useRef, useState } from 'react';
import type { Dict } from '@/lib/i18n/dict';

const MAX_SECONDS = 300;   // five minutes; past that, send a file

/** The first supported type wins. Safari does not do webm; Chromium does. */
function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function VoiceRecorder({
  dict, disabled, onRecorded,
}: {
  dict: Dict;
  disabled: boolean;
  onRecorded: (file: File, durationSeconds: number) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const cancelled = useRef(false);

  // Release the microphone if the component unmounts mid-recording. A held
  // mic shows a recording indicator in the browser chrome indefinitely.
  useEffect(() => () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function start() {
    setError(null);
    cancelled.current = false;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = rec;
      chunks.current = [];

      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };

      rec.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        stream.current = null;

        if (cancelled.current || chunks.current.length === 0) return;

        // MediaRecorder appends codec parameters to the type; strip them so
        // the declared MIME matches what magic-byte detection will report.
        const type = (rec.mimeType || 'audio/webm').split(';')[0] ?? 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const duration = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));

        onRecorded(
          new File([blob], `voice-${Date.now()}.${ext}`, { type }),
          duration,
        );
      };

      startedAt.current = Date.now();
      setSeconds(0);
      rec.start(250);   // emit chunks so a long note is not held entirely in memory
      setRecording(true);
    } catch (err) {
      const name = (err as Error).name;
      setError(name === 'NotAllowedError' ? dict.micDenied : dict.micUnavailable);
      setRecording(false);
    }
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setRecording(false);
  }

  function cancel() {
    cancelled.current = true;
    stop();
    setSeconds(0);
  }

  if (error) {
    return (
      <span role="alert" data-testid="voice-error" className="text-xs text-[var(--danger)]">
        {error}
      </span>
    );
  }

  if (!recording) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        data-testid="record-voice"
        aria-label={dict.recordVoice}
        className="touch-target shrink-0 rounded-md border border-[var(--border)] px-3 disabled:opacity-50"
      >
        🎙
      </button>
    );
  }

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="voice-recording">
      <button
        type="button"
        onClick={cancel}
        data-testid="cancel-voice"
        aria-label={dict.cancelRecording}
        className="touch-target rounded-md border border-[var(--border)] px-3"
      >
        ✕
      </button>

      <span className="flex items-center gap-1.5 text-xs">
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]" />
        {/* A duration is not directional text — 1:05 must not read as 05:1. */}
        <time dir="ltr" className="force-ltr tabular-nums" data-testid="voice-timer">
          {mm}:{ss}
        </time>
      </span>

      <button
        type="button"
        onClick={stop}
        data-testid="stop-voice"
        aria-label={dict.stopRecording}
        className="touch-target rounded-md bg-[var(--accent)] px-3 text-[var(--accent-on)]"
      >
        ✓
      </button>
    </div>
  );
}
