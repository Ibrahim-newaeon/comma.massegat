// src/app/api/search/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { rateLimit } from '@/lib/ratelimit';
import { ok, fail, handleError } from '@/lib/http';
import { toSearchText } from '@/lib/search/normalize';

const QuerySchema = z.object({
  q: z.string().min(2).max(200),
  channelId: z.string().uuid().optional(),
  senderId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  hasAttachment: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

type SearchRow = {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string | null;
  created_at: Date;
  snippet: string;
  sender_name: string;
  channel_name: string;
  channel_type: string;
  attachment_count: bigint;
};

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const limiter = await rateLimit(`search:${actor.id}`, 30, 60);
    if (!limiter.allowed) return fail('RATE_LIMITED', 'Too many searches.', 429);

    const q = QuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

    // Normalised identically to the indexer. Diverge and Arabic silently
    // returns nothing — the index holds one spelling, the query asks another.
    const normalized = toSearchText(q.q);
    if (!normalized) return ok({ results: [], query: q.q });

    // Optional filters, all parameterised. $queryRawUnsafe is banned.
    const filters: Prisma.Sql[] = [];
    if (q.channelId) filters.push(Prisma.sql`AND m.channel_id = ${q.channelId}::uuid`);
    if (q.senderId) filters.push(Prisma.sql`AND m.sender_id = ${q.senderId}::uuid`);
    if (q.from) filters.push(Prisma.sql`AND m.created_at >= ${new Date(q.from)}`);
    if (q.to) filters.push(Prisma.sql`AND m.created_at <= ${new Date(q.to)}`);
    if (q.hasAttachment === 'true') {
      filters.push(Prisma.sql`AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)`);
    }

    /**
     * Membership is a JOIN CONDITION, not a filter applied afterwards. A user
     * must be unable to learn that a message exists in a channel they are not
     * in — even by its absence from a result count.
     */
    const rows = await prisma.$queryRaw<SearchRow[]>`
      WITH q AS (SELECT websearch_to_tsquery('simple', ${normalized}) AS tsq)
      SELECT
        m.id,
        m.channel_id,
        m.sender_id,
        m.body,
        m.created_at,
        ts_headline('simple', coalesce(m.body, ''), q.tsq,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8, MaxFragments=1'
        ) AS snippet,
        u.display_name AS sender_name,
        c.name AS channel_name,
        c.type AS channel_type,
        (SELECT count(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count
      FROM messages m
      CROSS JOIN q
      JOIN channel_members cm
        ON cm.channel_id = m.channel_id AND cm.user_id = ${actor.id}::uuid
      JOIN users u ON u.id = m.sender_id
      JOIN channels c ON c.id = m.channel_id
      WHERE m.search_vector @@ q.tsq
        AND m.deleted_at IS NULL
        AND m.kind = 'user'
        ${filters.length > 0 ? Prisma.join(filters, ' ') : Prisma.empty}
      ORDER BY ts_rank(m.search_vector, q.tsq) DESC, m.created_at DESC
      LIMIT ${q.limit}
    `;

    // Full-text found nothing — fall back to trigram similarity, which
    // tolerates typos and partial words. Deliberately second: exact matches
    // must not be buried under fuzzy ones.
    let results = rows;
    if (rows.length === 0) {
      results = await prisma.$queryRaw<SearchRow[]>`
        SELECT
          m.id, m.channel_id, m.sender_id, m.body, m.created_at,
          left(coalesce(m.body, ''), 160) AS snippet,
          u.display_name AS sender_name,
          c.name AS channel_name,
          c.type AS channel_type,
          (SELECT count(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count
        FROM messages m
        JOIN channel_members cm
          ON cm.channel_id = m.channel_id AND cm.user_id = ${actor.id}::uuid
        JOIN users u ON u.id = m.sender_id
        JOIN channels c ON c.id = m.channel_id
        WHERE m.search_text % ${normalized}
          AND m.deleted_at IS NULL
          AND m.kind = 'user'
        ORDER BY similarity(m.search_text, ${normalized}) DESC
        LIMIT ${q.limit}
      `;
    }

    return ok({
      query: q.q,
      fuzzy: rows.length === 0 && results.length > 0,
      results: results.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        channelName: r.channel_name,
        channelType: r.channel_type,
        senderId: r.sender_id,
        senderName: r.sender_name,
        body: r.body,
        snippet: r.snippet,
        createdAt: r.created_at.toISOString(),
        attachmentCount: Number(r.attachment_count),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
