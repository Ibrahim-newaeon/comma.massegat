// src/app/api/auth/totp/verify/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyTotp, decryptSecret } from '@/lib/totp';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const limiter = await rateLimit(`totp:${actor.id}`, LIMITS.TOTP_PER_USER.limit, LIMITS.TOTP_PER_USER.window);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many attempts.', 429);

    const { code } = Schema.parse(await req.json());

    const user = await prisma.user.findUnique({ where: { id: actor.id } });
    const secret = user?.totpSecretEnc ? decryptSecret(user.totpSecretEnc) : null;
    if (!secret) return fail('NOT_ENROLLED', 'Start enrolment first', 400);

    if (!verifyTotp(secret, code)) {
      await audit({ actorId: actor.id, action: 'AUTH.TOTP_VERIFY_FAILED', ...requestContext(req) });
      return fail('INVALID_TOTP', 'Invalid authentication code', 401);
    }

    await prisma.user.update({ where: { id: actor.id }, data: { totpEnabled: true } });
    await audit({ actorId: actor.id, action: 'AUTH.TOTP_ENABLED', ...requestContext(req) });

    return ok({ enabled: true });
  } catch (err) {
    return handleError(err);
  }
}
