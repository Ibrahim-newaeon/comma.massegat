// src/app/api/auth/refresh/route.ts
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { rotateRefreshToken, signAccessToken } from '@/lib/tokens';
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from '@/lib/session';
import { generateCsrfToken } from '@/lib/csrf';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { ok, fail, handleError } from '@/lib/http';

export async function POST() {
  try {
    const jar = await cookies();
    const raw = jar.get(REFRESH_COOKIE)?.value;
    if (!raw) return fail('NO_REFRESH_TOKEN', 'Not authenticated', 401);

    const result = await rotateRefreshToken(raw);

    if (!result.ok) {
      await clearAuthCookies();
      // reuse_detected already revoked the family + wrote a SECURITY audit event
      return fail('REFRESH_REJECTED', 'Session expired. Please sign in again.', 401, {
        reason: result.reason,
      });
    }

    const limiter = await rateLimit(
      `refresh:${result.userId}`,
      LIMITS.REFRESH_PER_USER.limit,
      LIMITS.REFRESH_PER_USER.window,
    );
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many refresh attempts.', 429);

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, role: true, isActive: true, mustChangePassword: true, totpEnabled: true },
    });

    if (!user || !user.isActive) {
      await clearAuthCookies();
      return fail('ACCOUNT_INACTIVE', 'Session expired. Please sign in again.', 401);
    }

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      totpVerified: true,
    });
    const csrf = generateCsrfToken();
    await setAuthCookies(accessToken, result.raw, csrf);

    return ok({ refreshed: true });
  } catch (err) {
    return handleError(err);
  }
}
