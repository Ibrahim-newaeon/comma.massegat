// src/app/api/auth/signup/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { env } from '@/env';
import { hashPassword, isBreachedPassword, PasswordSchema } from '@/lib/password';
import { rateLimit } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(1).max(80),
  displayNameAr: z.string().trim().max(80).optional(),
  password: PasswordSchema,
});

function allowedDomains(): string[] {
  return env.SIGNUP_ALLOWED_DOMAINS
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/**
 * The email Cloudflare Access proved, if the request came through it.
 *
 * Cloudflare SETS this header and strips any client-supplied copy, so behind
 * Access it cannot be forged. Trusted only when TRUST_PROXY says a proxy is
 * actually in front — otherwise it is just a header anyone can send.
 */
function accessVerifiedEmail(req: Request): string | null {
  if (!env.TRUST_PROXY) return null;
  const email = req.headers.get('cf-access-authenticated-user-email');
  return email ? email.trim().toLowerCase() : null;
}

export async function POST(req: Request) {
  try {
    const ctx = requestContext(req);

    const domains = allowedDomains();
    if (domains.length === 0) {
      // Not an error state — signup is off unless someone turned it on.
      return fail('SIGNUP_DISABLED', 'Registration is not open. Ask an administrator for an invitation.', 403);
    }

    // Hard limit. A signup form on a public URL is the most attractive endpoint
    // in the application: it writes rows and hashes passwords, both expensive.
    const ipKey = ctx.ipAddress ?? 'unknown';
    const limiter = await rateLimit(`signup:${ipKey}`, 5, 3600);
    if (!limiter.allowed) {
      return fail('RATE_LIMITED', 'Too many registration attempts. Try again later.', 429);
    }

    const body = Schema.parse(await req.json());
    const claimed = body.email.toLowerCase();

    /**
     * ⚠️ The impersonation gap.
     *
     * Access proves WHO someone is; a form asks them to TYPE an email. Without
     * this check, a person who authenticated as ibrahim@ could register as
     * ceo@ and the platform would believe them.
     */
    const verified = accessVerifiedEmail(req);
    if (verified && verified !== claimed) {
      await audit({
        action: 'AUTH.SIGNUP_IDENTITY_MISMATCH',
        metadata: { claimed, verified },
        ...ctx,
      });
      return fail(
        'IDENTITY_MISMATCH',
        `You are signed in as ${verified}. Register with that address.`,
        403,
      );
    }

    const domain = claimed.split('@')[1] ?? '';
    if (!domains.includes(domain)) {
      await audit({ action: 'AUTH.SIGNUP_DOMAIN_REFUSED', metadata: { domain }, ...ctx });
      return fail('DOMAIN_NOT_ALLOWED', 'That email domain cannot register here.', 403);
    }

    if (await isBreachedPassword(body.password)) {
      return fail('PASSWORD_BREACHED', 'That password appears in a known breach. Choose another.', 400);
    }

    const existing = await prisma.user.findUnique({ where: { email: claimed } });

    /**
     * The same response whether or not the account exists.
     *
     * Differentiating turns this endpoint into an account-enumeration oracle —
     * anyone could test which colleagues are registered, which is useful for
     * phishing and worth nothing to a legitimate user.
     */
    const sameAnswer = ok({
      registered: true,
      pending: !env.SIGNUP_AUTO_APPROVE,
    }, 201);

    if (existing) {
      await audit({ action: 'AUTH.SIGNUP_DUPLICATE', metadata: { email: claimed }, ...ctx });
      return sameAnswer;
    }

    const passwordHash = await hashPassword(body.password);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: claimed,
          displayName: body.displayName,
          displayNameAr: body.displayNameAr || null,
          // ALWAYS member. Self-registration must never mint privilege, and
          // there is no input that could change this.
          role: 'member',
          isActive: env.SIGNUP_AUTO_APPROVE,
          approvalStatus: env.SIGNUP_AUTO_APPROVE ? 'approved' : 'pending',
          createdVia: verified ? 'signup_access' : 'signup',
          mustChangePassword: false,
        },
      });

      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: 'password',
          // Login looks the identity up by (provider, providerUid) — omitting
          // this creates an account that can never sign in.
          providerUid: claimed,
          passwordHash,
        },
      });

      // Only approved accounts join #general. A pending account with channel
      // membership would receive messages before anyone approved it.
      if (env.SIGNUP_AUTO_APPROVE) {
        const general = await tx.channel.findFirst({ where: { slug: 'general' } });
        if (general) {
          await tx.channelMember.create({
            data: { channelId: general.id, userId: user.id },
          });
        }
      }

      await audit({
        actorId: user.id,
        action: 'AUTH.SIGNUP',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          email: claimed,
          accessVerified: Boolean(verified),
          autoApproved: env.SIGNUP_AUTO_APPROVE,
        },
        ...ctx,
      });
    });

    return sameAnswer;
  } catch (err) {
    return handleError(err);
  }
}
