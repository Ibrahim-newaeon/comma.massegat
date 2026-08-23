// src/app/api/calls/webhook/route.ts
export const runtime = 'nodejs';

import { WebhookReceiver } from 'livekit-server-sdk';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { postCallEndedMessage } from '@/lib/calls/systemMessage';

const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

/**
 * Mirrors SFU events into call_sessions / call_participants for audit.
 *
 * The signature is verified before anything is trusted. An unauthenticated
 * webhook endpoint would let anyone forge call records — including claiming
 * someone attended a call they were never on.
 */
export async function POST(req: Request) {
  let event;
  try {
    const body = await req.text();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Missing signature', { status: 401 });
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    console.error('[call webhook] signature verification failed', err);
    return new Response('Invalid signature', { status: 401 });
  }

  try {
    const roomName = event.room?.name;
    const identity = event.participant?.identity;
    if (!roomName) return new Response('ok');

    const session = await prisma.callSession.findFirst({ where: { roomName, endedAt: null } });
    if (!session) return new Response('ok');

    switch (event.event) {
      case 'participant_left': {
        if (!identity) break;
        await prisma.callParticipant.updateMany({
          where: { sessionId: session.id, userId: identity, leftAt: null },
          data: { leftAt: new Date() },
        });

        // Auto-end when the last person leaves, so a stale session does not
        // make the channel look permanently "in a call".
        const remaining = await prisma.callParticipant.count({
          where: { sessionId: session.id, leftAt: null },
        });
        if (remaining === 0) {
          await prisma.callSession.update({
            where: { id: session.id },
            data: { endedAt: new Date(), endReason: 'all_participants_left' },
          });
          // Covers a tab closed without a graceful leave — the socket handler
          // never fires then. postCallEndedMessage is idempotent, so both
          // paths running is harmless.
          await postCallEndedMessage(session.id).catch((e) =>
            console.error('[call webhook] system message failed', e));
        }
        break;
      }

      case 'room_finished': {
        await prisma.callParticipant.updateMany({
          where: { sessionId: session.id, leftAt: null },
          data: { leftAt: new Date() },
        });
        await prisma.callSession.update({
          where: { id: session.id },
          data: { endedAt: new Date(), endReason: 'room_finished' },
        });
        await postCallEndedMessage(session.id).catch((e) =>
          console.error('[call webhook] system message failed', e));

        await audit({
          action: 'CALL.ENDED', targetType: 'call_session', targetId: session.id,
          metadata: { roomName },
        });
        break;
      }
    }
  } catch (err) {
    // Never 500 back to the SFU — it would retry indefinitely.
    console.error('[call webhook] handler error', err);
  }

  return new Response('ok');
}
