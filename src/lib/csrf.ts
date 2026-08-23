// src/lib/csrf.ts
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { CSRF_COOKIE } from '@/lib/session';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Double-submit cookie check. Required on every cookie-authenticated mutation.
 * Uses timing-safe comparison.
 */
export async function assertCsrf(req: Request): Promise<void> {
  const header = req.headers.get('x-csrf-token');
  const jar = await cookies();
  const cookie = jar.get(CSRF_COOKIE)?.value;

  if (!header || !cookie || header.length !== cookie.length) {
    throw new CsrfError();
  }
  if (!crypto.timingSafeEqual(Buffer.from(header), Buffer.from(cookie))) {
    throw new CsrfError();
  }
}

export class CsrfError extends Error {
  constructor() {
    super('CSRF token mismatch');
    this.name = 'CsrfError';
  }
}
