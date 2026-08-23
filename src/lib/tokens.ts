// src/lib/tokens.ts
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export type AccessClaims = {
  sub: string;
  role: string;
  mustChangePassword: boolean;
  totpVerified: boolean;
};

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
    return {
      sub: String(payload.sub),
      role: String(payload.role),
      mustChangePassword: Boolean(payload.mustChangePassword),
      totpVerified: Boolean(payload.totpVerified),
    };
  } catch {
    return null;
  }
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

/** Issues a refresh token. Pass familyId to continue an existing rotation lineage. */
export async function issueRefreshToken(
  userId: string,
  familyId?: string,
  context?: { userAgent?: string | null; ipAddress?: string | null; amr?: string[] },
) {
  const raw = randomToken();
  const family = familyId ?? crypto.randomUUID();

  // On rotation the device context is carried forward from the family rather
  // than re-read: a rotated token comes from the same device by definition,
  // and re-reading would let a proxy change alter what the user sees.
  let carried = context;
  if (familyId && !context) {
    const previous = await prisma.refreshToken.findFirst({
      where: { familyId },
      orderBy: { createdAt: 'asc' },
      select: { userAgent: true, ipAddress: true, amr: true },
    });
    carried = previous
      ? {
          userAgent: previous.userAgent,
          ipAddress: previous.ipAddress,
          amr: (previous.amr as string[] | null) ?? undefined,
        }
      : undefined;
  }

  await prisma.refreshToken.create({
    data: {
      userId,
      familyId: family,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
      userAgent: carried?.userAgent?.slice(0, 255) ?? null,
      ipAddress: carried?.ipAddress ?? null,
      amr: carried?.amr ?? undefined,
    },
  });

  return { raw, familyId: family };
}

/** The family the current request belongs to, or null. */
export async function currentFamilyId(rawRefreshToken: string | undefined): Promise<string | null> {
  if (!rawRefreshToken) return null;
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawRefreshToken) },
    select: { familyId: true },
  });
  return row?.familyId ?? null;
}

export type RotateResult =
  | { ok: true; userId: string; raw: string; familyId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'reuse_detected' };

/**
 * Rotates a refresh token.
 *
 * SECURITY: presenting an already-consumed token means the token leaked.
 * The entire family is revoked and a SECURITY audit event is written.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  const tokenHash = sha256(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) return { ok: false, reason: 'not_found' };

  if (existing.consumedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit({
      actorId: existing.userId,
      action: 'SECURITY.REFRESH_TOKEN_REUSE',
      targetType: 'refresh_token_family',
      targetId: existing.familyId,
      metadata: { revokedFamily: true },
    });
    return { ok: false, reason: 'reuse_detected' };
  }

  if (existing.revokedAt) return { ok: false, reason: 'revoked' };
  if (existing.expiresAt < new Date()) return { ok: false, reason: 'expired' };

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { consumedAt: new Date() },
  });

  const next = await issueRefreshToken(existing.userId, existing.familyId);
  return { ok: true, userId: existing.userId, raw: next.raw, familyId: next.familyId };
}

export async function revokeAllUserTokens(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeRefreshToken(rawToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function createSetupToken(userId: string) {
  const raw = randomToken();
  await prisma.setupToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.setupToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + env.SETUP_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return raw;
}

export async function consumeSetupToken(rawToken: string): Promise<string | null> {
  const record = await prisma.setupToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;
  await prisma.setupToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record.userId;
}
