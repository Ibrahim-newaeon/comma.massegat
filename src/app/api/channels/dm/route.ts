// src/app/api/channels/dm/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z.object({ peerId: z.string().uuid() });

/** Opens (or reuses) a DM. DMs are channels with type='dm' and two members. */
export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const { peerId } = Schema.parse(await req.json());
    if (peerId === actor.id) return fail('INVALID_PEER', 'Cannot DM yourself', 400);

    const peer = await prisma.user.findFirst({ where: { id: peerId, isActive: true } });
    if (!peer) return fail('NOT_FOUND', 'User not found', 404);

    // Deterministic slug means opening the same DM twice reuses one channel,
    // regardless of who initiates.
    const slug = `dm-${[actor.id, peerId].sort().join('-')}`;

    const existing = await prisma.channel.findUnique({ where: { slug } });
    if (existing) return ok({ channelId: existing.id, created: false });

    const channel = await prisma.channel.create({
      data: {
        slug,
        name: 'Direct message',
        type: 'dm',
        createdBy: actor.id,
        members: { createMany: { data: [{ userId: actor.id }, { userId: peerId }] } },
      },
    });

    await audit({
      actorId: actor.id, action: 'CHAT.DM_CREATED',
      targetType: 'channel', targetId: channel.id, ...requestContext(req),
    });

    return ok({ channelId: channel.id, created: true }, 201);
  } catch (err) {
    return handleError(err);
  }
}
