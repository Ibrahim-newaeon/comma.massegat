// src/app/api/me/sessions/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getActor, REFRESH_COOKIE } from '@/lib/session';
import { currentFamilyId } from '@/lib/tokens';
import { assertCsrf } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';



/**
 * A session IS a refresh-token family. Rotation creates a new row in the same
 * family, so the family is the device and the rows are its history.
 */
function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const jar = await cookies();
    const current = await currentFamilyId(jar.get(REFRESH_COOKIE)?.value);

    const rows = await prisma.refreshToken.findMany({
      where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: {
        familyId: true, createdAt: true, userAgent: true, ipAddress: true, amr: true,
      },
    });

    // Collapse the family's rows into one entry: the FIRST row is when the
    // device signed in, the LAST is when it was last active. Showing every
    // rotation would list the same laptop dozens of times.
    const byFamily = new Map<string, {
      familyId: string; signedInAt: Date; lastSeenAt: Date;
      userAgent: string | null; ipAddress: string | null; amr: string[];
    }>();

    for (const r of rows) {
      const existing = byFamily.get(r.familyId);
      if (existing) {
        existing.lastSeenAt = r.createdAt;
      } else {
        byFamily.set(r.familyId, {
          familyId: r.familyId,
          signedInAt: r.createdAt,
          lastSeenAt: r.createdAt,
          userAgent: r.userAgent,
          ipAddress: r.ipAddress,
          amr: (r.amr as string[] | null) ?? [],
        });
      }
    }

    const sessions = [...byFamily.values()]
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map((s) => ({
        id: s.familyId,
        device: describeDevice(s.userAgent),
        // Shown so someone can spot a session from an address they do not
        // recognise.
        ipAddress: s.ipAddress,
        signedInAt: s.signedInAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        twoFactor: s.amr.includes('otp'),
        isCurrent: s.familyId === current,
      }));

    return ok({ sessions });
  } catch (err) {
    return handleError(err);
  }
}

const DeleteSchema = z.object({
  /** Omit to revoke every OTHER session — the "I lost my laptop" case. */
  familyId: z.string().uuid().optional(),
});

export async function DELETE(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const { familyId } = DeleteSchema.parse(await req.json().catch(() => ({})));

    const jar = await cookies();
    const current = await currentFamilyId(jar.get(REFRESH_COOKIE)?.value);

    // Never revoke the current session here. Signing yourself out while trying
    // to secure your account is a confusing failure — /logout is the
    // deliberate path for that.
    if (familyId && familyId === current) {
      return fail('CANNOT_REVOKE_CURRENT', 'Use sign out for this device', 400);
    }

    const result = await prisma.refreshToken.updateMany({
      where: familyId
        ? { userId: actor.id, familyId, revokedAt: null }
        : { userId: actor.id, revokedAt: null, familyId: { not: current ?? '' } },
      data: { revokedAt: new Date(), revokedReason: 'user_revoked' },
    });

    /**
     * ⚠️ The other device keeps its ACCESS token until it expires — up to 15
     * minutes of continued access after revocation. Killing it instantly would
     * mean checking a revocation list on every request, which is the tradeoff
     * stateless JWTs exist to avoid. Shortening ACCESS_TOKEN_TTL_SECONDS
     * narrows the window if that is unacceptable.
     */
    await audit({
      actorId: actor.id,
      action: familyId ? 'SESSION.REVOKED_ONE' : 'SESSION.REVOKED_OTHERS',
      targetType: 'user', targetId: actor.id,
      metadata: { rowsRevoked: result.count, familyId: familyId ?? null },
      ...requestContext(req),
    });

    return ok({ revoked: result.count });
  } catch (err) {
    return handleError(err);
  }
}
