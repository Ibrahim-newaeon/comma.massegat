// src/app/api/auth/logout/route.ts
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { revokeRefreshToken } from '@/lib/tokens';
import { clearAuthCookies, getActor, REFRESH_COOKIE } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, handleError } from '@/lib/http';

export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    const jar = await cookies();
    const raw = jar.get(REFRESH_COOKIE)?.value;

    if (raw) await revokeRefreshToken(raw);
    await clearAuthCookies();

    if (actor) await audit({ actorId: actor.id, action: 'AUTH.LOGOUT', ...requestContext(req) });
    return ok({ loggedOut: true });
  } catch (err) {
    return handleError(err);
  }
}
