'use client';
// src/components/calls/ParticipantTile.tsx
import { useEffect, useRef } from 'react';
import type { CallParticipantView } from '@/lib/calls/types';
import type { Locale } from '@/lib/i18n/dict';

export function ParticipantTile({
  participant, locale, prominent,
}: {
  participant: CallParticipantView;
  locale: Locale;
  prominent: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    participant.attachVideo(video.current);
    participant.attachAudio(audio.current);
    return () => { participant.attachVideo(null); participant.attachAudio(null); };
  // Re-attach only when the PARTICIPANT changes, not on every re-render.
  // snapshot() returns fresh objects on every SFU event — and
  // ActiveSpeakersChanged fires constantly — so depending on object identity
  // detached and reattached the video element on each one. Visible as flicker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant.userId, participant.videoEnabled, participant.isScreenSharing]);

  const name = locale === 'ar' && participant.displayNameAr
    ? participant.displayNameAr
    : participant.displayName;

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-black ${
        participant.isSpeaking ? 'ring-2 ring-[var(--accent)]' : ''
      } ${prominent ? 'h-full w-full' : 'aspect-video'}`}
      data-testid="participant-tile"
      data-user-id={participant.userId}
      data-speaking={participant.isSpeaking}
      data-video-enabled={participant.videoEnabled}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        // The local preview is mirrored — people expect to see themselves as
        // in a mirror. Screen shares are NOT mirrored; text would read backwards.
        muted={participant.isLocal}
        className={`h-full w-full object-contain ${
          participant.isLocal && !participant.isScreenSharing ? 'scale-x-[-1]' : ''
        } ${participant.videoEnabled || participant.isScreenSharing ? '' : 'hidden'}`}
      />

      {!participant.videoEnabled && !participant.isScreenSharing && (
        <div className="flex h-full w-full items-center justify-center bg-[var(--surface)]"
             data-testid="camera-off-placeholder">
          <span className="text-2xl font-semibold opacity-60">
            <bdi dir="auto">{name.slice(0, 2).toUpperCase()}</bdi>
          </span>
        </div>
      )}

      {/* Audio element is never rendered for the local participant — hearing
          yourself back is disorienting and causes feedback. */}
      {!participant.isLocal && <audio ref={audio} autoPlay />}

      <div className="absolute inset-inline-start-0 inset-block-end-0 flex items-center gap-1 bg-black/60 px-2 py-1 text-xs text-white">
        <bdi dir="auto" data-testid="participant-name">{name}</bdi>
        {!participant.audioEnabled && <span aria-label="muted" data-testid="muted-icon">🔇</span>}
        {participant.isScreenSharing && <span aria-label="screen sharing">🖥</span>}
      </div>
    </div>
  );
}
