// src/lib/chat/types.ts
export type AttachmentDTO = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** pending | clean | infected | error | rejected */
  scanStatus: string;
  hasThumbnail: boolean;
};

/**
 * Reactions grouped by emoji, not a flat list.
 *
 * The client needs "👍 3, and one of them is me" — grouping on the server
 * means every client does not repeat the same reduce, and `mine` is computed
 * where the viewer's identity is already known.
 */
export type ReactionDTO = {
  emoji: string;
  count: number;
  /**
   * Who reacted. The client derives its own `mine` from this rather than the
   * server computing it — otherwise every broadcast would need serialising
   * once per recipient, turning one emit into N.
   *
   * Not a leak: these are channel members, already visible to each other.
   */
  userIds: string[];
  /** Display names, for the tooltip. Capped server-side at 8. */
  names: string[];
};

export type MessageDTO = {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderNameAr: string | null;
  body: string | null;
  bodyLang: string | null;
  replyToId: string | null;
  clientMsgId: string;
  seq: string;              // BigInt serialized — JSON cannot carry BigInt
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments: AttachmentDTO[];
  /** 'user' | 'system' — system messages render as centred notices. */
  kind: string;
  systemData: CallEndedData | null;
  reactions: ReactionDTO[];
  /**
   * A preview of the message being replied to, resolved server-side.
   *
   * Inline quoting rather than a separate thread view: for a small team,
   * WhatsApp-style replies keep one readable timeline, and everyone already
   * knows the interaction. A thread pane splits the conversation in two and
   * people miss half of it.
   */
  replyTo: ReplyPreviewDTO | null;
};

export type ReplyPreviewDTO = {
  id: string;
  senderName: string;
  senderNameAr: string | null;
  /** Truncated server-side — a quote is a pointer, not a copy. */
  body: string | null;
  /** True when the original was withdrawn. The quote becomes a tombstone. */
  deleted: boolean;
  /** Shown when the original was a file with no caption. */
  hasAttachments: boolean;
};

export type CallEndedData = {
  type: 'call_ended';
  durationSeconds: number;
  participantCount: number;
  participantNames: string[];
};

export type ChannelDTO = {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  type: 'public' | 'private' | 'dm';
  unreadCount: number;
  lastMessageAt: string | null;
  /** One-line preview for the sidebar. Null for a channel with no messages. */
  lastMessage: {
    body: string | null;
    senderId: string;
    senderName: string;
    kind: string;
    attachmentCount: number;
  } | null;
  /** For DMs: the other participant. Null for group channels. */
  peer: { id: string; displayName: string; displayNameAr: string | null } | null;
};

export type PresenceStatus = 'online' | 'offline';
