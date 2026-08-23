// src/lib/session.ts
import { cookies } from 'next/headers';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { verifyAccessToken } from '@/lib/tokens';
import type { Actor } from '@/lib/authorize';

export const ACCESS_COOKIE = 'cp_access';
export const REFRESH_COOKIE = 'cp_refresh';
export const CSRF_COOKIE = 'cp_csrf';

const secure = env.NODE_ENV === 'production';

export async function setAuthCookies(accessToken: string, refreshToken: string, csrf: string) {
  const jar = await cookies();

  jar.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS,
  });

  jar.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  });

  // Readable by JS on purpose — double-submit CSRF pattern.
  jar.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/**
 * Resolves the current actor. Re-reads the DB so that a deactivated user
 * loses access immediately, without waiting for their JWT to expire.
 */
export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return { id: user.id, role: user.role, isActive: user.isActive };
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  return prisma.user.findFirst({
    where: { id: claims.sub, isActive: true },
    select: {
      id: true,
      email: true,
      displayName: true,
      displayNameAr: true,
      role: true,
      locale: true,
      numeralPref: true,
      mustChangePassword: true,
      totpEnabled: true,
    },
  });
}
