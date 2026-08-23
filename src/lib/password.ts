// src/lib/password.ts
import argon2 from 'argon2';
import { z } from 'zod';

/**
 * Argon2id parameters.
 *
 * ⚠️ BENCHMARK THESE ON YOUR PRODUCTION HARDWARE before go-live.
 * Target: 250-500ms per hash. Run `npx tsx scripts/benchmark-argon2.ts`.
 * Measured: mean 291ms (min 277 / max 307) on a Windows dev laptop.
 * 19456 KiB gave 20ms — far too fast. Re-benchmark on production hardware.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 262144, // 256 MiB
  timeCost: 2,
  parallelism: 1,
};

export const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256, 'Password must be at most 256 characters');

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/** Always returns boolean. Never throws on malformed hash — fails closed. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Checks a password against the HaveIBeenPwned range API (k-anonymity:
 * only the first 5 chars of the SHA-1 hash leave this process).
 * Fails OPEN — a network outage must not block a password change.
 */
export async function isBreachedPassword(plain: string): Promise<boolean> {
  try {
    const crypto = await import('node:crypto');
    const sha1 = crypto.createHash('sha1').update(plain).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;

    const body = await res.text();
    return body.split('\n').some((line) => line.split(':')[0]?.trim() === suffix);
  } catch {
    return false;
  }
}
