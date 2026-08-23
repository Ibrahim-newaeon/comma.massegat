'use client';
// src/lib/calls/SfuTransport.ts
// The ONLY file that imports the LiveKit client SDK. Everything above it talks
// to the MediaTransport interface, so replacing the SFU vendor means replacing
// this file and nothing else.
import {
  Room, RoomEvent, Track, ConnectionQuality as LKQuality,
  type RemoteParticipant, type LocalParticipant, type Participant,
} from 'livekit-client';
import type {
  MediaTransport, CallParticipantView, TransportStats,
  MediaDeviceOption, ConnectionQuality,
} from './types';

function mapQuality(q: LKQuality | undefined): ConnectionQuality {
  switch (q) {
    case LKQuality.Excellent: return 'excellent';
    case LKQuality.Good: return 'good';
    case LKQuality.Poor: return 'poor';
    case LKQuality.Lost: return 'lost';
    default: return 'unknown';
  }
}

/** Identity is the internal userId, set server-side when the token is minted. */
function identityOf(p: Participant): string {
  return p.identity;
}

export class SfuTransport implements MediaTransport {
  private room: Room | null = null;
  private participantsCb: ((p: CallParticipantView[]) => void) | null = null;
  private speakerCb: ((userId: string | null) => void) | null = null;
  private disconnectCb: ((reason: string) => void) | null = null;
  private statsCb: ((s: TransportStats) => void) | null = null;

  async join(url: string, token: string): Promise<void> {
    const room = new Room({
      adaptiveStream: true,   // drops resolution for participants on weak links
      dynacast: true,         // stops publishing layers nobody is subscribed to
      publishDefaults: {
        // Simulcast lets the SFU forward a lower layer to weak receivers
        // without the sender re-encoding. This is why an SFU scales and a
        // mesh does not.
        simulcast: true,
      },
    });
    this.room = room;

    const emit = () => this.participantsCb?.(this.snapshot());

    room
      .on(RoomEvent.ParticipantConnected, emit)
      .on(RoomEvent.ParticipantDisconnected, emit)
      .on(RoomEvent.TrackSubscribed, emit)
      .on(RoomEvent.TrackUnsubscribed, emit)
      .on(RoomEvent.TrackMuted, emit)
      .on(RoomEvent.TrackUnmuted, emit)
      .on(RoomEvent.LocalTrackPublished, emit)
      .on(RoomEvent.LocalTrackUnpublished, emit)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        this.speakerCb?.(speakers.length > 0 ? identityOf(speakers[0]!) : null);
        emit();
      })
      .on(RoomEvent.ConnectionQualityChanged, () => {
        const local = room.localParticipant;
        this.statsCb?.({
          quality: mapQuality(local.connectionQuality),
          packetsLostPercent: null,
          roundTripMs: null,
        });
      })
      .on(RoomEvent.Disconnected, (reason) => {
        this.disconnectCb?.(reason ? String(reason) : 'disconnected');
      })
      // Fires on ICE drop before giving up. Not an error — the SDK is retrying.
      .on(RoomEvent.Reconnecting, () => {
        this.statsCb?.({ quality: 'poor', packetsLostPercent: null, roundTripMs: null });
      })
      .on(RoomEvent.Reconnected, () => {
        this.statsCb?.({ quality: 'good', packetsLostPercent: null, roundTripMs: null });
        emit();
      });

    await room.connect(url, token);
    await room.localParticipant.enableCameraAndMicrophone();
    emit();
  }

  async leave(): Promise<void> {
    await this.room?.disconnect();
    this.room = null;
  }

  private snapshot(): CallParticipantView[] {
    const room = this.room;
    if (!room) return [];

    const build = (p: LocalParticipant | RemoteParticipant, isLocal: boolean): CallParticipantView => {
      const camera = p.getTrackPublication(Track.Source.Camera);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const screen = p.getTrackPublication(Track.Source.ScreenShare);

      let meta: { displayName?: string; displayNameAr?: string | null } = {};
      try { meta = p.metadata ? JSON.parse(p.metadata) : {}; } catch { /* ignore */ }

      return {
        userId: identityOf(p),
        displayName: meta.displayName ?? p.name ?? p.identity,
        displayNameAr: meta.displayNameAr ?? null,
        isLocal,
        isSpeaking: p.isSpeaking,
        audioEnabled: Boolean(mic && !mic.isMuted),
        videoEnabled: Boolean(camera && !camera.isMuted),
        isScreenSharing: Boolean(screen && screen.isSubscribed !== false),
        attachVideo: (el) => {
          const pub = screen ?? camera;
          if (!el) { pub?.track?.detach(); return; }
          pub?.track?.attach(el);
        },
        attachAudio: (el) => {
          // The local participant must never hear themselves.
          if (isLocal || !el) { mic?.track?.detach(); return; }
          mic?.track?.attach(el);
        },
      };
    };

    return [
      build(room.localParticipant, true),
      ...Array.from(room.remoteParticipants.values()).map((p) => build(p, false)),
    ];
  }

  onParticipantsChanged(cb: (p: CallParticipantView[]) => void) { this.participantsCb = cb; }
  onActiveSpeakerChanged(cb: (userId: string | null) => void) { this.speakerCb = cb; }
  onDisconnected(cb: (reason: string) => void) { this.disconnectCb = cb; }
  onStatsChanged(cb: (s: TransportStats) => void) { this.statsCb = cb; }

  async toggleAudio(enabled: boolean) {
    await this.room?.localParticipant.setMicrophoneEnabled(enabled);
    this.participantsCb?.(this.snapshot());
  }

  async toggleVideo(enabled: boolean) {
    await this.room?.localParticipant.setCameraEnabled(enabled);
    this.participantsCb?.(this.snapshot());
  }

  async startScreenShare() {
    // audio:false — sharing system audio surprises people and often echoes.
    await this.room?.localParticipant.setScreenShareEnabled(true, { audio: false });
    this.participantsCb?.(this.snapshot());
  }

  async stopScreenShare() {
    await this.room?.localParticipant.setScreenShareEnabled(false);
    this.participantsCb?.(this.snapshot());
  }

  async listDevices(kind: MediaDeviceKind): Promise<MediaDeviceOption[]> {
    const devices = await Room.getLocalDevices(kind);
    return devices.map((d, i) => ({
      deviceId: d.deviceId,
      // Labels are empty until permission is granted — fall back to a number
      // rather than showing a blank row.
      label: d.label || `${kind} ${i + 1}`,
    }));
  }

  async selectDevice(kind: MediaDeviceKind, deviceId: string) {
    await this.room?.switchActiveDevice(kind, deviceId);
    this.participantsCb?.(this.snapshot());
  }
}
