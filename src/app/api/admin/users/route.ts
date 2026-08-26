// src/app/api/admin/users/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { PALETTE_SIZE } from '@/lib/ui/senderColor';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/authorize';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { createSetupToken } from '@/lib/tokens';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const CreateUserSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(120),
  displayNameAr: z.string().max(120).optional(),
  role: z.enum(['member', 'moderator', 'admin']),
  locale: z.enum(['en', 'ar']).default('en'),
  colorIndex: z.number().int().min(0).max(PALETTE_SIZE - 1).nullable().optional(),
});

export async function GET() {
  try {
    const actor = await getActor();
    authorize(actor, 'user:create'); // admin-only surface

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, displayName: true, displayNameAr: true,
        role: true, locale: true, isActive: true, mustChangePassword: true,
        totpEnabled: true, createdAt: true, deactivatedAt: true,
      },
    });
    return ok({ users });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    authorize(actor, 'user:create');

    const limiter = await rateLimit(`admin:${actor.id}`, LIMITS.ADMIN_MUTATION.limit, LIMITS.ADMIN_MUTATION.window);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many admin operations.', 429);

    const body = CreateUserSchema.parse(await req.json());
    const emailKey = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: emailKey } });
    if (existing) return fail('EMAIL_IN_USE', 'A user with this email already exists', 409);

    // No password is generated or shown. The user sets their own via the setup link.
    const user = await prisma.user.create({
      data: {
        email: emailKey,
        displayName: body.displayName,
        displayNameAr: body.displayNameAr ?? null,
        role: body.role,
        locale: body.locale,
        mustChangePassword: true,
        createdById: actor.id,
        identities: {
          create: { provider: 'password', providerUid: emailKey, passwordHash: null },
        },
      },
    });

    // BUG: without this a new hire signs in to an empty app with nothing to
    // click. seed-channels only backfills users who existed when it ran.
    const general = await prisma.channel.findUnique({ where: { slug: 'general' } });
    if (general) {
      await prisma.channelMember.createMany({
        data: [{ channelId: general.id, userId: user.id }],
        skipDuplicates: true,
      });
    }

    const setupToken = await createSetupToken(user.id);
    const setupUrl = `${env.APP_URL}/change-password?setup=${setupToken}`;

    await audit({
      actorId: actor.id,
      action: 'ADMIN.USER_CREATED',
      targetType: 'user',
      targetId: user.id,
      metadata: { email: emailKey, role: body.role },
      ...requestContext(req),
    });

    return ok({
      userId: user.id,
      setupUrl,
      // The invite dialog shows a real expiry rather than guessing one.
      expiresAt: new Date(Date.now() + env.SETUP_TOKEN_TTL_SECONDS * 1000).toISOString(),
    }, 201);
  } catch (err) {
    return handleError(err);
  }
}
