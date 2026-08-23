// src/server/socket/events.ts
// Every inbound payload is validated against these on receipt.
// NOTE: no schema contains senderId or userId. Identity comes from
// socket.data.userId, set by the auth middleware. Never from the client.
import { z } from 'zod';

export const MessageSendSchema = z.object({
  channelId: z.string().uuid(),
  body: z.string().min(1).max(8000),
  replyToId: z.string().uuid().optional(),
  clientMsgId: z.string().min(8).max(64),
});

export const MessageEditSchema = z.object({
  messageId: z.string().uuid(),
  body: z.string().min(1).max(8000),
});

export const MessageDeleteSchema = z.object({ messageId: z.string().uuid() });
export const ChannelRefSchema = z.object({ channelId: z.string().uuid() });

export const ReadAdvanceSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const SyncSinceSchema = z.object({
  channelId: z.string().uuid(),
  sinceSeq: z.string().regex(/^\d+$/),
});

export type MessageSend = z.infer<typeof MessageSendSchema>;
