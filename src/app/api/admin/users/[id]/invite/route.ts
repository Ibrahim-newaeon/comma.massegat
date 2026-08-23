// src/app/api/admin/users/[id]/invite/route.ts
export const runtime = 'nodejs';

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { authorize } from '@/lib/authorize';
import { rateLimit } from '@/lib/ratelimit';
import { createSetupToken } from '@/lib/tokens';
import { audit, requestContext } from '@/lib/audit';
import { env } from '@/env';
import { ok, fail, handleError } from '@/lib/http';

/**
 * Reissues a setup link.
 *
 * Needed more often than it sounds: links expire, people delete the message,
 * and someone starting on Monday was invited on Friday.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    // Reissuing a setup link IS a password reset — the holder can set the
    // account's password. Filing it under the same permission means one entry
    // in the table governs every path that can take over an account.
    authorize(actor, 'user:reset_password');

    const { id } = await params;

    const limiter = await rateLimit(`invite:${actor.id}`, 30, 3600);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many invitations. Try again later.', 429);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, isActive: true },
    });
    if (!user) return fail('NOT_FOUND', 'User not found', 404);
    if (!user.isActive) return fail('USER_INACTIVE', 'Reactivate this account first', 409);

    // createSetupToken already invalidates every previous unused link for this
    // person — a stale link in an old email is otherwise a live credential.
    const raw = await createSetupToken(id);
    const expiresAt = new Date(Date.now() + env.SETUP_TOKEN_TTL_SECONDS * 1000);

    await audit({
      actorId: actor.id, action: 'USER.INVITE_REISSUED',
      targetType: 'user', targetId: id,
      // The token is NEVER written to the audit log — it is a credential, and
      // the audit viewer is readable by every admin.
      metadata: { email: user.email, reissued: true },
      ...requestContext(req),
    });

    return ok({
      setupUrl: `${env.APP_URL}/change-password?setup=${raw}`,
      expiresAt: expiresAt.toISOString(),
      displayName: user.displayName,
      email: user.email,
      // Surfaced so the admin knows this is a RESET, not a first invitation —
      // the wording they send should differ.
      // Anyone reissuing is resetting access, whether or not the person ever
      // signed in. "Password reset link" is the safer wording to send.
      isReset: true,
    });
  } catch (err) {
    return handleError(err);
  }
}
