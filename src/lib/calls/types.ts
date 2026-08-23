// src/lib/calls/types.ts
export type CallParticipantView = {
  userId: string;
  displayName: string;
  displayNameAr: string | null;
  isLocal: boolean;
  isSpeaking: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  /** Attached by the transport; components never touch the SDK directly. */
  attachVideo: (el: HTMLVideoElement | null) => void;
  attachAudio: (el: HTMLAudioElement | null) => void;
};

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export type TransportStats = {
  quality: ConnectionQuality;
  packetsLostPercent: number | null;
  roundTripMs: number | null;
};

export type MediaDeviceOption = { deviceId: string; label: string };

export type CallState =
  | { phase: 'idle' }
  | { phase: 'ringing'; sessionId: string; from: string; channelId: string }
  | { phase: 'connecting'; sessionId: string }
  | { phase: 'connected'; sessionId: string }
  | { phase: 'ended'; reason: string };

/**
 * The ONLY surface UI components may use. No component references
 * RTCPeerConnection or a vendor SDK class — swapping SFU providers must not
 * touch the UI layer. See MEGA-PROMPT §9.6.
 */
export interface MediaTransport {
  join(url: string, token: string): Promise<void>;
  leave(): Promise<void>;

  onParticipantsChanged(cb: (participants: CallParticipantView[]) => void): void;
  onActiveSpeakerChanged(cb: (userId: string | null) => void): void;
  onDisconnected(cb: (reason: string) => void): void;
  onStatsChanged(cb: (stats: TransportStats) => void): void;

  toggleAudio(enabled: boolean): Promise<void>;
  toggleVideo(enabled: boolean): Promise<void>;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;

  listDevices(kind: MediaDeviceKind): Promise<MediaDeviceOption[]>;
  selectDevice(kind: MediaDeviceKind, deviceId: string): Promise<void>;
}
