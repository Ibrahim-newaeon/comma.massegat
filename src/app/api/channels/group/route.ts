// src/app/api/channels/group/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { authorize } from '@/lib/authorize';
import { rateLimit } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z.object({
  name: z.string().trim().min(1).max(60),
  // At least one other person: a "group" of one is a notes-to-self channel,
  // which is a different feature with different expectations.
  memberIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * A group IS a channel — `type: 'private'`, with an explicit membership list.
 * No separate model: groups and channels have the same messages, the same
 * files, the same calls. The only difference is who can see them and who
 * decided that.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKC')
    // Keep Arabic: a group named "فريق التسويق" must not slug to "".
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Suffixed unconditionally: two teams may both create "Design", and a
  // collision would 500 on a unique constraint.
  return `${base || 'group'}-${Date.now().toString(36)}`;
}

export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    authorize(actor, 'group:create');

    const limiter = await rateLimit(`group:create:${actor.id}`, 10, 3600);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many groups created. Try again later.', 429);

    const body = Schema.parse(await req.json());

    // The creator is always a member, whether or not they listed themselves.
    const memberIds = [...new Set([actor.id, ...body.memberIds])];

    // Every id must be a real, active user. Otherwise a typo'd or deactivated
    // id silently creates a group with a member who can never appear.
    const users = await prisma.user.findMany({
      where: { id: { in: memberIds }, isActive: true },
      select: { id: true },
    });
    if (users.length !== memberIds.length) {
      return fail('INVALID_MEMBERS', 'One or more people could not be added', 400);
    }

    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          slug: slugify(body.name),
          name: body.name,
          type: 'private',
          createdBy: actor.id,
        },
      });

      await tx.channelMember.createMany({
        data: memberIds.map((userId) => ({
          channelId: created.id,
          userId,
          // The creator is an owner: someone has to be able to rename it or
          // add people later without finding an admin.
          role: userId === actor.id ? 'owner' : 'member',
        })),
      });

      return created;
    });

    await audit({
      actorId: actor.id, action: 'CHANNEL.GROUP_CREATED',
      targetType: 'channel', targetId: channel.id,
      metadata: { name: body.name, memberCount: memberIds.length },
      ...requestContext(req),
    });

    return ok({
      channelId: channel.id,
      slug: channel.slug,
      name: channel.name,
      memberCount: memberIds.length,
    }, 201);
  } catch (err) {
    return handleError(err);
  }
}
