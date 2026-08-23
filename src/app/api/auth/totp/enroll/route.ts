// src/app/api/auth/totp/enroll/route.ts
export const runtime = 'nodejs';

import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { generateTotpSecret, encryptSecret, totpKeyUri } from '@/lib/totp';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const user = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!user) return fail('NOT_FOUND', 'User not found', 404);
    if (user.totpEnabled) return fail('ALREADY_ENROLLED', 'TOTP is already enabled', 409);

    const secret = generateTotpSecret();

    // Stored encrypted but NOT enabled until a code is verified.
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: encryptSecret(secret) },
    });

    const uri = totpKeyUri(user.email, secret);
    const qrDataUrl = await QRCode.toDataURL(uri);

    await audit({ actorId: user.id, action: 'AUTH.TOTP_ENROLL_STARTED', ...requestContext(req) });
    return ok({ secret, uri, qrDataUrl });
  } catch (err) {
    return handleError(err);
  }
}
