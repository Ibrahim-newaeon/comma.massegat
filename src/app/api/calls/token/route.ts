// src/app/api/calls/token/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { authorize } from '@/lib/authorize';
import { rateLimit } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z.object({ channelId: z.string().uuid() });

/**
 * Mints a scoped, short-lived room token.
 *
 * The SFU handles all SDP and ICE negotiation. This server's ONLY job in the
 * media path is deciding who is allowed into which room — which is why every
 * check lives here.
 *
 * The room name is DERIVED from the channel, never taken from the client.
 * A client-supplied room name would let anyone join any conversation by
 * guessing an identifier.
 */
export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    authorize(actor, 'call:join');

    const limiter = await rateLimit(`call:token:${actor.id}`, 30, 600);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many call attempts.', 429);

    const { channelId } = Schema.parse(await req.json());

    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: actor.id } },
    });
    if (!member) return fail('FORBIDDEN', 'Not a member of this channel', 403);

    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) return fail('NOT_FOUND', 'Channel not found', 404);

    const roomName = `call-${channelId}`;

    // Reuse the live session if one exists, so everyone lands in one room.
    let session = await prisma.callSession.findFirst({
      where: { roomName, endedAt: null },
    });

    if (!session) {
      session = await prisma.callSession.create({
        data: {
          roomName,
          channelId,
          type: channel.type === 'dm' ? 'direct' : 'group',
          startedBy: actor.id,
        },
      });
      await audit({
        actorId: actor.id, action: 'CALL.STARTED',
        targetType: 'call_session', targetId: session.id,
        metadata: { channelId, type: session.type }, ...requestContext(req),
      });
    }

    // Hard cap, enforced server-side before the token is minted. An SFU could
    // carry more, but every extra participant costs bandwidth and screen space.
    const active = await prisma.callParticipant.count({
      where: { sessionId: session.id, leftAt: null },
    });
    const alreadyIn = await prisma.callParticipant.findFirst({
      where: { sessionId: session.id, userId: actor.id, leftAt: null },
    });

    if (!alreadyIn && active >= env.MAX_CALL_PARTICIPANTS) {
      return fail('CALL_FULL', `This call is full (${env.MAX_CALL_PARTICIPANTS} participants maximum)`, 409);
    }

    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { displayName: true, displayNameAr: true },
    });

    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      // Identity is the internal userId — that is how SFU participants are
      // correlated back to call_participants rows.
      identity: actor.id,
      name: user?.displayName ?? 'Unknown',
      metadata: JSON.stringify({
        displayName: user?.displayName ?? 'Unknown',
        displayNameAr: user?.displayNameAr ?? null,
      }),
      ttl: env.CALL_TOKEN_TTL_SECONDS,
    });

    // Deliberately narrow. roomAdmin and roomCreate are NEVER granted to an
    // end user — either would let them evict others or open arbitrary rooms.
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    if (!alreadyIn) {
      await prisma.callParticipant.create({ data: { sessionId: session.id, userId: actor.id } });
    }

    await audit({
      actorId: actor.id, action: 'CALL.JOINED',
      targetType: 'call_session', targetId: session.id,
      metadata: { channelId }, ...requestContext(req),
    });

    return ok({
      token: await token.toJwt(),
      url: env.LIVEKIT_URL,
      roomName,
      sessionId: session.id,
      maxParticipants: env.MAX_CALL_PARTICIPANTS,
    });
  } catch (err) {
    return handleError(err);
  }
}
