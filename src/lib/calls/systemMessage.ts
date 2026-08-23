// src/lib/calls/systemMessage.ts
// Posts a "call ended" notice into the channel.
//
// A call that leaves no trace in the conversation is confusing — someone
// scrolling back has no idea a meeting happened. Slack and Teams both post
// one for that reason.
import crypto from 'node:crypto';
import { prisma } from '@/lib/db';

export type CallSummary = {
  durationSeconds: number;
  participantCount: number;
  participantNames: string[];
};

/**
 * senderId is set to whoever STARTED the call rather than making the column
 * nullable. A migration to allow null would touch every existing query and
 * every join; attributing the notice to the starter is honest and cheaper.
 */
export async function postCallEndedMessage(sessionId: string): Promise<string | null> {
  const session = await prisma.callSession.findUnique({
    where: { id: sessionId },
    include: {
      participants: { include: { user: { select: { id: true, displayName: true, displayNameAr: true } } } },
    },
  });

  if (!session || !session.endedAt) return null;

  // Idempotent: webhook and socket handler can both fire for the same call.
  const clientMsgId = `call-${sessionId}`;
  const existing = await prisma.message.findUnique({
    where: { senderId_clientMsgId: { senderId: session.startedBy, clientMsgId } },
  });
  if (existing) return existing.id;

  const durationSeconds = Math.max(
    0,
    Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 1000),
  );

  // A call nobody answered is noise, not history.
  if (session.participants.length <= 1 && durationSeconds < 15) return null;

  const summary: CallSummary = {
    durationSeconds,
    participantCount: session.participants.length,
    participantNames: session.participants.map((p) => p.user.displayName),
  };

  const message = await prisma.message.create({
    data: {
      channelId: session.channelId,
      senderId: session.startedBy,
      // Body is a plain-text fallback for anything that does not understand
      // the system kind — search, exports, an older client.
      body: `Call ended · ${summary.participantCount} participant${summary.participantCount === 1 ? '' : 's'} · ${formatDuration(durationSeconds)}`,
      bodyLang: 'en',
      kind: 'system',
      systemData: { type: 'call_ended', ...summary } as object,
      clientMsgId,
    },
  });

  return message.id;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s === 0 ? `${m} min` : `${m} min ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Deterministic id so a retry cannot post the notice twice. */
export function callMessageId(sessionId: string): string {
  return `call-${sessionId}`;
}
void crypto;
