// src/app/api/files/quota/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getActor } from '@/lib/session';
import { ok, fail, handleError } from '@/lib/http';
import { userUsage, channelUsage, formatBytes } from '@/lib/files/quota';
import { prisma } from '@/lib/db';

/** Surfaces usage so a user sees the limit approaching, not only on rejection. */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const channelId = new URL(req.url).searchParams.get('channelId');
    const user = await userUsage(actor.id);

    let channel = null;
    if (channelId) {
      const member = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId: actor.id } },
      });
      if (member) {
        const c = await channelUsage(channelId);
        channel = { ...c, usedLabel: formatBytes(c.usedBytes), limitLabel: formatBytes(c.limitBytes) };
      }
    }

    return ok({
      user: { ...user, usedLabel: formatBytes(user.usedBytes), limitLabel: formatBytes(user.limitBytes) },
      channel,
    });
  } catch (err) {
    return handleError(err);
  }
}
