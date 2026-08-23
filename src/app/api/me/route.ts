// src/app/api/me/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';
import { env } from '@/env';

/**
 * Deliberately narrow.
 *
 * email and role are NOT here. A user changing their own role is privilege
 * escalation; a user changing their own email is account takeover of whatever
 * that address can reset. Both stay with an admin, and both are audited there.
 */
const PatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  // Nullable, not just optional — clearing an Arabic name must be possible,
  // and '' would store an empty string that renders as a blank name.
  displayNameAr: z.string().trim().max(80).nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true, email: true, displayName: true, displayNameAr: true,
        locale: true, theme: true, role: true, createdAt: true,
      },
    });
    if (!user) return fail('NOT_FOUND', 'User not found', 404);

    const totp = await prisma.authIdentity.findFirst({
      where: { userId: actor.id, provider: 'totp' },
      select: { id: true, createdAt: true },
    });

    // Sum of what this person has uploaded, against their quota.
    const usage = await prisma.attachment.aggregate({
      where: { uploaderId: actor.id, scanStatus: { notIn: ['infected', 'purged'] } },
      _sum: { sizeBytes: true },
      _count: true,
    });

    const devices = await prisma.pushSubscription.count({ where: { userId: actor.id } });

    return ok({
      user: { ...user, createdAt: user.createdAt.toISOString(), lastLoginAt: null },
      totpEnabled: Boolean(totp),
      totpEnrolledAt: totp?.createdAt.toISOString() ?? null,
      storage: {
        usedBytes: Number(usage._sum.sizeBytes ?? 0),
        quotaBytes: env.USER_QUOTA_BYTES,
        fileCount: usage._count,
      },
      pushDevices: devices,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const limiter = await rateLimit(`me:patch:${actor.id}`, 20, 300);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many changes. Try again shortly.', 429);

    const body = PatchSchema.parse(await req.json());
    if (Object.keys(body).length === 0) return fail('VALIDATION_ERROR', 'Nothing to update', 400);

    const before = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { displayName: true, displayNameAr: true, locale: true, theme: true },
    });

    const user = await prisma.user.update({
      where: { id: actor.id },
      data: {
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.displayNameAr !== undefined && {
          // Empty string collapses to null, so a cleared field renders as
          // absent rather than as a blank name.
          displayNameAr: body.displayNameAr === '' ? null : body.displayNameAr,
        }),
        ...(body.locale !== undefined && { locale: body.locale }),
        ...(body.theme !== undefined && { theme: body.theme }),
      },
      select: { id: true, displayName: true, displayNameAr: true, locale: true, theme: true },
    });

    // A display name is what everyone else sees attached to messages. A change
    // is worth a record — impersonation starts with a rename.
    await audit({
      actorId: actor.id, action: 'PROFILE.UPDATED',
      targetType: 'user', targetId: actor.id,
      metadata: { before, after: body },
      ...requestContext(req),
    });

    return ok({ user });
  } catch (err) {
    return handleError(err);
  }
}
