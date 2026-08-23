// src/app/api/admin/audit/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/authorize';
import { getActor } from '@/lib/session';
import { ok, handleError } from '@/lib/http';

const QuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    authorize(actor, 'audit:read');

    const url = new URL(req.url);
    const q = QuerySchema.parse(Object.fromEntries(url.searchParams));

    const rows = await prisma.auditLog.findMany({
      where: {
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit,
      ...(q.cursor ? { cursor: { id: BigInt(q.cursor) }, skip: 1 } : {}),
    });

    return ok({
      entries: rows.map((r) => ({ ...r, id: r.id.toString() })),
      nextCursor: rows.length === q.limit ? rows[rows.length - 1]?.id.toString() : null,
    });
  } catch (err) {
    return handleError(err);
  }
}
