// src/app/api/push/vapid/route.ts
export const runtime = 'nodejs';

import { env } from '@/env';
import { ok, fail } from '@/lib/http';

/** The PUBLIC key only. The private key never leaves the server. */
export async function GET() {
  if (!env.VAPID_PUBLIC_KEY) {
    return fail('PUSH_NOT_CONFIGURED', 'Push notifications are not configured', 503);
  }
  return ok({ publicKey: env.VAPID_PUBLIC_KEY });
}
