// tests/helpers/totp.ts
// Generates a real TOTP code for a test account.
//
// We deliberately do NOT disable 2FA for tests. Disabling it would mean the
// login path under test is not the login path that ships. Instead we decrypt
// the stored secret with the same key the server uses and derive a live code —
// the tests authenticate exactly as a human with an authenticator app does.
import crypto from 'node:crypto';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';

config();
const prisma = new PrismaClient();
const ALGO = 'aes-256-gcm';

function decryptSecret(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const key = Buffer.from(process.env.TOTP_ENCRYPTION_KEY ?? '', 'base64');
    const d = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

/** Returns a valid 6-digit code, or null if the account has no TOTP enrolled. */
export async function currentTotpCode(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { totpEnabled: true, totpSecretEnc: true },
  });
  if (!user?.totpEnabled || !user.totpSecretEnc) return null;

  const secret = decryptSecret(user.totpSecretEnc);
  if (!secret) {
    throw new Error('Could not decrypt the TOTP secret. TOTP_ENCRYPTION_KEY does not match the enrolment key.');
  }
  return authenticator.generate(secret);
}
