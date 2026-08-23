'use client';
// src/lib/calls/useCall.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SfuTransport } from './SfuTransport';
import type {
  MediaTransport, CallParticipantView, TransportStats, CallState,
} from './types';
import { csrfToken, ApiError } from '@/lib/csrfClient';
import { playRingtone, playCallEndSound } from '@/lib/chat/sound';

export function useCall(socket: React.RefObject<Socket | null>) {
  const transport = useRef<MediaTransport | null>(null);
  const [state, setState] = useState<CallState>({ phase: 'idle' });
  const [participants, setParticipants] = useState<CallParticipantView[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [stats, setStats] = useState<TransportStats>({ quality: 'unknown', packetsLostPercent: null, roundTripMs: null });
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Epoch ms of the moment this client connected. The timer anchors to this
  // rather than counting ticks, so it survives background-tab throttling.
  const [startedAt, setStartedAt] = useState<number>(0);

  const sessionRef = useRef<string | null>(null);
  // Two joins with the same identity make LiveKit evict the first
  // (DUPLICATE_IDENTITY), whose disconnect event then tore down the second.
  // Bumping this makes a stale callback a no-op.
  const joinGeneration = useRef(0);
  // Stop function for the ringtone. A ring that outlives the call is worse
  // than no ring at all, so this is cleared on every state change.
  const stopRing = useRef<(() => void) | null>(null);

  const teardown = useCallback(async () => {
    stopRing.current?.();
    stopRing.current = null;
    await transport.current?.leave().catch(() => { /* already gone */ });
    transport.current = null;
    if (sessionRef.current) socket.current?.emit('call:left', { sessionId: sessionRef.current });
    sessionRef.current = null;
    setParticipants([]);
    setActiveSpeaker(null);
    setSharing(false);
  }, [socket]);

  const join = useCallback(async (channelId: string) => {
    setError(null);
    setState({ phase: 'connecting', sessionId: '' });

    try {
      const res = await fetch('/api/calls/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ channelId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new ApiError(json?.error?.code ?? 'TOKEN_FAILED', json?.error?.message ?? 'Could not join the call');
      }

      const { token, url, sessionId } = json.data as { token: string; url: string; sessionId: string };
      sessionRef.current = sessionId;

      const t = new SfuTransport();
      transport.current = t;

      t.onParticipantsChanged(setParticipants);
      t.onActiveSpeakerChanged(setActiveSpeaker);
      t.onStatsChanged(setStats);
      t.onDisconnected((reason) => {
        setState({ phase: 'ended', reason });
        void teardown();
      });

      await t.join(url, token);

      setState({ phase: 'connected', sessionId });
      setStartedAt(Date.now());
      setAudioOn(true);
      setVideoOn(true);
      socket.current?.emit('call:joined', { sessionId });
      socket.current?.emit('call:initiate', { channelId });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join the call');
      setState({ phase: 'idle' });
      await teardown();
    }
  }, [socket, teardown]);

  const leave = useCallback(async () => {
    // A disconnect WE initiated must not overwrite the idle state we are about
    // to set. Bumping the generation makes the stale callback a no-op — the
    // same guard already used against DUPLICATE_IDENTITY.
    joinGeneration.current += 1;
    await teardown();
    setState({ phase: 'idle' });
  }, [teardown]);

  const toggleAudio = useCallback(async () => {
    const next = !audioOn;
    await transport.current?.toggleAudio(next);
    setAudioOn(next);
  }, [audioOn]);

  const toggleVideo = useCallback(async () => {
    const next = !videoOn;
    await transport.current?.toggleVideo(next);
    setVideoOn(next);
  }, [videoOn]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (sharing) { await transport.current?.stopScreenShare(); setSharing(false); }
      else { await transport.current?.startScreenShare(); setSharing(true); }
    } catch {
      // The user dismissed the browser's picker. Not an error worth surfacing.
      setSharing(false);
    }
  }, [sharing]);

  // Incoming call ringing
  useEffect(() => {
    const s = socket.current;
    if (!s) return;

    const onIncoming = (p: { sessionId: string; channelId: string; fromUserId: string; fromName: string }) => {
      setState((prev) => (prev.phase === 'idle'
        ? { phase: 'ringing', sessionId: p.sessionId, from: p.fromName, channelId: p.channelId }
        : prev));
    };
    const onEnded = () => { setState({ phase: 'ended', reason: 'ended' }); void teardown(); };

    s.on('call:incoming', onIncoming);
    s.on('call:ended', onEnded);
    return () => { s.off('call:incoming', onIncoming); s.off('call:ended', onEnded); };
  }, [socket, teardown]);

  // Ring only while the dialog is up. Cleanup runs on every phase change,
  // so accepting, declining or the caller hanging up all silence it.
  useEffect(() => {
    if (state.phase !== 'ringing') return;
    stopRing.current = playRingtone();
    return () => { stopRing.current?.(); stopRing.current = null; };
  }, [state.phase]);

  // A descending pair when the call ends — reads as "ended", not "arrived".
  useEffect(() => {
    if (state.phase === 'ended') playCallEndSound();
  }, [state.phase]);

  // 'ended' exists so the end tone can play and any notice can show. It must
  // then return to idle, or the call button stays disabled until a refresh.
  useEffect(() => {
    if (state.phase !== 'ended') return;
    const id = setTimeout(() => setState({ phase: 'idle' }), 1500);
    return () => clearTimeout(id);
  }, [state.phase]);

  // Leaving the page must not strand the session as "still in a call".
  useEffect(() => () => { void teardown(); }, [teardown]);

  return {
    state, participants, activeSpeaker, stats, startedAt,
    audioOn, videoOn, sharing, error,
    join, leave, toggleAudio, toggleVideo, toggleScreenShare,
    decline: () => {
      if (state.phase === 'ringing') socket.current?.emit('call:decline', { sessionId: state.sessionId });
      setState({ phase: 'idle' });
    },
    transport,
  };
}
