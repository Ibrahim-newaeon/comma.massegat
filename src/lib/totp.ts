// src/lib/totp.ts
import crypto from 'node:crypto';
import { authenticator } from 'otplib';
import { env } from '@/env';

const ALGO = 'aes-256-gcm';
/**
 * Derived lazily, not at module load.
 *
 * Next imports every route module while collecting page data at build time,
 * where runtime configuration does not exist. Decoding here at module scope
 * meant Buffer.from(undefined) and a build failure in routes with nothing
 * wrong with them.
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  cachedKey ??= Buffer.from(env.TOTP_ENCRYPTION_KEY, 'base64');
  return cachedKey;
}

export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'Comms Platform', secret);
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}
