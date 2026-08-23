// src/app/api/auth/change-password/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, isBreachedPassword, PasswordSchema } from '@/lib/password';
import { revokeAllUserTokens, issueRefreshToken, signAccessToken, consumeSetupToken } from '@/lib/tokens';
import { getActor, setAuthCookies } from '@/lib/session';
import { assertCsrf, generateCsrfToken } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z
  .object({
    currentPassword: z.string().max(256).optional(),
    setupToken: z.string().max(200).optional(),
    newPassword: PasswordSchema,
  })
  .refine((d) => d.currentPassword || d.setupToken, {
    message: 'Either currentPassword or setupToken is required',
  });

export async function POST(req: Request) {
  try {
    const ctx = requestContext(req);
    const body = Schema.parse(await req.json());

    let userId: string | null = null;

    if (body.setupToken) {
      // First-login path — no session yet, so no CSRF cookie to check.
      userId = await consumeSetupToken(body.setupToken);
      if (!userId) return fail('INVALID_SETUP_TOKEN', 'This link is invalid or has expired', 400);
    } else {
      await assertCsrf(req);
      const actor = await getActor();
      if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

      const identity = await prisma.authIdentity.findFirst({
        where: { userId: actor.id, provider: 'password' },
      });
      if (!identity?.passwordHash) return fail('NO_PASSWORD_IDENTITY', 'Cannot change password', 400);

      const valid = await verifyPassword(identity.passwordHash, body.currentPassword ?? '');
      if (!valid) {
        await audit({ actorId: actor.id, action: 'AUTH.CHANGE_PASSWORD_FAILED', ...ctx });
        return fail('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
      }
      userId = actor.id;
    }

    if (await isBreachedPassword(body.newPassword)) {
      return fail('BREACHED_PASSWORD', 'This password has appeared in a known data breach. Choose another.', 400);
    }

    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) return fail('ACCOUNT_INACTIVE', 'Account is not active', 403);

    const newHash = await hashPassword(body.newPassword);

    await prisma.$transaction([
      prisma.authIdentity.updateMany({
        where: { userId, provider: 'password' },
        data: { passwordHash: newHash },
      }),
      prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } }),
    ]);

    // Invalidate every other session.
    await revokeAllUserTokens(userId);

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role,
      mustChangePassword: false,
      totpVerified: !user.totpEnabled,
    });
    const { raw: refreshToken } = await issueRefreshToken(user.id);
    await setAuthCookies(accessToken, refreshToken, generateCsrfToken());

    await audit({ actorId: userId, action: 'AUTH.PASSWORD_CHANGED', ...ctx });
    return ok({ changed: true, role: user.role });
  } catch (err) {
    return handleError(err);
  }
}
