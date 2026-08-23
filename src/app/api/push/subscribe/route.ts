// src/app/api/push/subscribe/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const Schema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const body = Schema.parse(await req.json());

    // Upsert on endpoint: re-subscribing on the same device must not create a
    // second row, or every notification is delivered twice.
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { userId: actor.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
      create: {
        userId: actor.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: req.headers.get('user-agent')?.slice(0, 255) ?? null,
      },
    });

    await audit({ actorId: actor.id, action: 'PUSH.SUBSCRIBED', ...requestContext(req) });
    return ok({ subscribed: true }, 201);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await req.json());
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: actor.id } });

    await audit({ actorId: actor.id, action: 'PUSH.UNSUBSCRIBED', ...requestContext(req) });
    return ok({ unsubscribed: true });
  } catch (err) {
    return handleError(err);
  }
}
