'use client';
// src/components/calls/CallView.tsx
import { useMemo } from 'react';
import { ParticipantTile } from './ParticipantTile';
import { CallTimer } from './CallTimer';
import type { CallParticipantView, TransportStats } from '@/lib/calls/types';
import type { Dict, Locale } from '@/lib/i18n/dict';

const QUALITY_LABEL: Record<string, string> = {
  excellent: '●●●', good: '●●○', poor: '●○○', lost: '○○○', unknown: '···',
};

export function CallView({
  participants, activeSpeaker, stats, dict, locale, startedAt,
  audioOn, videoOn, sharing,
  onToggleAudio, onToggleVideo, onToggleShare, onLeave,
  onPopOut, pipActive, pipSupported: canPip,
}: {
  participants: CallParticipantView[];
  activeSpeaker: string | null;
  stats: TransportStats;
  dict: Dict;
  locale: Locale;
  /** Epoch ms when this client joined. Anchors the timer. */
  startedAt: number;
  audioOn: boolean;
  videoOn: boolean;
  sharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleShare: () => void;
  onLeave: () => void;
  /** Moves the call into a floating window, or back. */
  onPopOut?: () => void;
  pipActive?: boolean;
  pipSupported?: boolean;
}) {
  // Grid up to six. Beyond that, tiles get too small to read a face — switch
  // to speaker focus with the rest as a filmstrip.
  const speakerFocus = participants.length > 6 || participants.some((p) => p.isScreenSharing);

  const focused = useMemo(() => {
    const shared = participants.find((p) => p.isScreenSharing);
    if (shared) return shared;
    return participants.find((p) => p.userId === activeSpeaker)
      ?? participants.find((p) => !p.isLocal)
      ?? participants[0]
      ?? null;
  }, [participants, activeSpeaker]);

  const others = participants.filter((p) => p.userId !== focused?.userId);

  return (
    <section className="flex h-full flex-col bg-[var(--fg)]" data-testid="call-view">
      <header className="flex items-center justify-between px-4 py-2 text-xs text-white">
        <span className="flex items-center gap-3">
          <span data-testid="call-participant-count">
            {participants.length} {dict.inCall}
          </span>
          {/* A live recording-style dot next to the timer, so it reads as
              "in progress" rather than as a static number. */}
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]" />
            <CallTimer startedAt={startedAt} />
          </span>
        </span>
        <span
          data-testid="connection-quality"
          data-quality={stats.quality}
          aria-label={`${dict.connectionQuality}: ${stats.quality}`}
        >
          {QUALITY_LABEL[stats.quality] ?? '···'}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2">
        {speakerFocus && focused ? (
          <div className="flex h-full flex-col gap-2">
            <div className="min-h-0 flex-1">
              <ParticipantTile participant={focused} locale={locale} prominent />
            </div>
            {others.length > 0 && (
              <div className="flex shrink-0 gap-2 overflow-x-auto" data-testid="call-filmstrip">
                {others.map((p) => (
                  <div key={p.userId} className="w-32 shrink-0">
                    <ParticipantTile participant={p} locale={locale} prominent={false} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className="grid h-full gap-2"
            data-testid="call-grid"
            style={{
              gridTemplateColumns: `repeat(${Math.min(participants.length, 3)}, minmax(0, 1fr))`,
            }}
          >
            {participants.map((p) => (
              <ParticipantTile key={p.userId} participant={p} locale={locale} prominent={false} />
            ))}
          </div>
        )}
      </div>

      {/* Controls are NOT mirrored in RTL — media controls are spatial, not
          directional. See MEGA-PROMPT §6.5. */}
      <footer className="flex shrink-0 items-center justify-center gap-3 p-3" dir="ltr">
        <button type="button" onClick={onToggleAudio}
          data-testid="toggle-audio" data-enabled={audioOn}
          aria-label={audioOn ? dict.muteAudio : dict.unmuteAudio} aria-pressed={!audioOn}
          className={`h-14 w-14 rounded-full text-xl ${audioOn ? 'bg-white/20' : 'bg-[var(--danger)]'}`}>
          {audioOn ? '🎤' : '🔇'}
        </button>

        <button type="button" onClick={onToggleVideo}
          data-testid="toggle-video" data-enabled={videoOn}
          aria-label={videoOn ? dict.stopVideo : dict.startVideo} aria-pressed={!videoOn}
          className={`h-14 w-14 rounded-full text-xl ${videoOn ? 'bg-white/20' : 'bg-[var(--danger)]'}`}>
          {videoOn ? '📹' : '🚫'}
        </button>

        <button type="button" onClick={onToggleShare}
          data-testid="toggle-screenshare" data-enabled={sharing}
          aria-label={dict.shareScreen} aria-pressed={sharing}
          className={`hidden h-14 w-14 rounded-full text-xl sm:block ${sharing ? 'bg-[var(--accent)]' : 'bg-white/20'}`}>
          🖥
        </button>

        {canPip && onPopOut && (
          <button type="button" onClick={onPopOut}
            data-testid="pop-out-call"
            aria-label={pipActive ? dict.popIn : dict.popOut}
            title={pipActive ? dict.popIn : dict.popOut}
            className="hidden h-14 w-14 rounded-full bg-white/20 text-xl md:block">
            {pipActive ? '⇤' : '⇥'}
          </button>
        )}

        <button type="button" onClick={onLeave}
          data-testid="leave-call" aria-label={dict.leaveCall}
          className="h-14 w-14 rounded-full bg-[var(--danger)] text-xl">
          📞
        </button>
      </footer>
    </section>
  );
}
