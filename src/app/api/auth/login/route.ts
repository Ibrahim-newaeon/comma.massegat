// src/app/api/auth/login/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { verifyTotp, decryptSecret } from '@/lib/totp';
import { signAccessToken, issueRefreshToken } from '@/lib/tokens';
import { setAuthCookies } from '@/lib/session';
import { generateCsrfToken } from '@/lib/csrf';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { redis } from '@/lib/redis';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = requestContext(req);
    const body = LoginSchema.parse(await req.json());
    const emailKey = body.email.toLowerCase();

    // Two independent limiters: per-account and per-IP.
    const [byAccount, byIp] = await Promise.all([
      rateLimit(`login:acct:${emailKey}`, LIMITS.LOGIN_PER_ACCOUNT.limit, LIMITS.LOGIN_PER_ACCOUNT.window),
      rateLimit(`login:ip:${ctx.ipAddress ?? 'unknown'}`, LIMITS.LOGIN_PER_IP.limit, LIMITS.LOGIN_PER_IP.window),
    ]);

    if (!byAccount.allowed || !byIp.allowed) {
      await audit({ action: 'AUTH.LOGIN_RATE_LIMITED', targetType: 'email', targetId: emailKey, ...ctx });
      return fail('RATE_LIMITED', 'Too many attempts. Please try again later.', 429, {
        retryAfterSeconds: Math.max(byAccount.retryAfterSeconds, byIp.retryAfterSeconds),
      });
    }

    const identity = await prisma.authIdentity.findUnique({
      where: { provider_providerUid: { provider: 'password', providerUid: emailKey } },
      include: { user: true },
    });

    // Generic failure for every case below — never disclose account existence.
    const GENERIC = () => fail('INVALID_CREDENTIALS', 'Invalid email or password', 401);

    if (!identity?.passwordHash) {
      await audit({ action: 'AUTH.LOGIN_FAILED', targetType: 'email', targetId: emailKey,
        metadata: { reason: 'no_identity' }, ...ctx });
      return GENERIC();
    }

    const passwordOk = await verifyPassword(identity.passwordHash, body.password);
    if (!passwordOk) {
      await audit({ actorId: identity.userId, action: 'AUTH.LOGIN_FAILED',
        metadata: { reason: 'bad_password' }, ...ctx });
      return GENERIC();
    }

    const user = identity.user;
    if (!user.isActive) {
      await audit({ actorId: user.id, action: 'AUTH.LOGIN_FAILED',
        metadata: { reason: 'deactivated' }, ...ctx });
      return GENERIC();
    }

    // Admins must complete TOTP. Enrolment is handled post-login.
    let totpVerified = !user.totpEnabled;

    if (user.totpEnabled) {
      if (!body.totpCode) {
        // The password was CORRECT — this is not a failed attempt. Without
        // clearing, every 2FA sign-in leaves a permanent increment and five
        // successful logins lock the account out.
        try {
          await redis.del(`rl:login:acct:${emailKey}`);
          await redis.del(`rl:login:ip:${ctx.ipAddress ?? 'unknown'}`);
        } catch { /* counter expires on its own */ }
        return fail('TOTP_REQUIRED', 'Authentication code required', 401);
      }

      const limiter = await rateLimit(`totp:${user.id}`, LIMITS.TOTP_PER_USER.limit, LIMITS.TOTP_PER_USER.window);
      if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many attempts.', 429);

      const secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc) : null;
      if (!secret || !verifyTotp(secret, body.totpCode)) {
        await audit({ actorId: user.id, action: 'AUTH.TOTP_FAILED', ...ctx });
        return fail('INVALID_TOTP', 'Invalid authentication code', 401);
      }
      // A valid code is not a failed attempt — clear the counter, or ten
      // successful sign-ins lock the user out of their own second factor.
      try { await redis.del(`rl:totp:${user.id}`); } catch { /* expires */ }
      totpVerified = true;
    }

    // A pending account has a valid password and no business being let in.
    // Checked AFTER the password so the message cannot be used to discover
    // which addresses are awaiting approval.
    if (user.approvalStatus === 'pending') {
      await audit({ actorId: user.id, action: 'AUTH.LOGIN_PENDING', ...ctx });
      return fail(
        'ACCOUNT_PENDING',
        'Your account is waiting for an administrator to approve it.',
        403,
      );
    }
    if (user.approvalStatus === 'rejected') {
      await audit({ actorId: user.id, action: 'AUTH.LOGIN_REJECTED', ...ctx });
      return fail('ACCOUNT_REJECTED', 'This account cannot sign in.', 403);
    }

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      totpVerified,
    });
    const { raw: refreshToken } = await issueRefreshToken(user.id, undefined, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: ctx.ipAddress ?? null,
      amr: totpVerified ? ['pwd', 'otp'] : ['pwd'],
    });
    const csrf = generateCsrfToken();
    await setAuthCookies(accessToken, refreshToken, csrf);

    // Lockout counts FAILURES, not traffic. A successful sign-in clears the
    // counters — otherwise a legitimate user who signs in six times in fifteen
    // minutes locks themselves out, and one office IP locks out everyone.
    try {
      await redis.del(`rl:login:acct:${emailKey}`);
      await redis.del(`rl:login:ip:${ctx.ipAddress ?? 'unknown'}`);
    } catch { /* counters expire on their own */ }

    await audit({ actorId: user.id, action: 'AUTH.LOGIN_SUCCESS', ...ctx });

    return ok({
      userId: user.id,
      role: user.role,
      locale: user.locale,
      mustChangePassword: user.mustChangePassword,
      totpEnrolmentRequired: user.role === 'admin' && !user.totpEnabled,
    });
  } catch (err) {
    return handleError(err);
  }
}
