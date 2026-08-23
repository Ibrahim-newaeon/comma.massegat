// src/app/api/messages/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { ok, fail, handleError } from '@/lib/http';
import { groupReactions } from '@/lib/chat/reactions';
import type { MessageDTO } from '@/lib/chat/types';

const QuerySchema = z.object({
  channelId: z.string().uuid(),
  // Keyset pagination. Never OFFSET — it degrades and skips rows under writes.
  beforeSeq: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const q = QuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

    // Membership checked server-side on every read.
    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: q.channelId, userId: actor.id } },
    });
    if (!member) return fail('FORBIDDEN', 'Not a member of this channel', 403);

    const rows = await prisma.message.findMany({
      where: {
        channelId: q.channelId,
        ...(q.beforeSeq ? { seq: { lt: BigInt(q.beforeSeq) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: q.limit,
      include: {
        sender: { select: { displayName: true, displayNameAr: true } },
        attachments: {
          select: {
            id: true, filename: true, mimeType: true, sizeBytes: true,
            scanStatus: true, thumbnailKey: true,
          },
        },
        // Must match the socket path's include. Without it, reactions appear
        // live and then vanish on reload — the worst kind of bug, because it
        // looks like the reaction was never saved.
        reactions: {
          select: { emoji: true, userId: true, user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        replyTo: {
          select: {
            id: true, body: true, deletedAt: true,
            sender: { select: { displayName: true, displayNameAr: true } },
            _count: { select: { attachments: true } },
          },
        },
      },
    });

    const messages: MessageDTO[] = rows.reverse().map((m) => ({
      id: m.id,
      channelId: m.channelId,
      senderId: m.senderId,
      senderName: m.sender.displayName,
      senderNameAr: m.sender.displayNameAr,
      body: m.deletedAt ? null : m.body,
      bodyLang: m.bodyLang,
      replyToId: m.replyToId,
      clientMsgId: m.clientMsgId,
      seq: m.seq.toString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      deletedAt: m.deletedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      kind: m.kind ?? 'user',
      systemData: (m.systemData as MessageDTO['systemData']) ?? null,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: Number(a.sizeBytes),
        scanStatus: a.scanStatus,
        hasThumbnail: Boolean(a.thumbnailKey),
      })),
      reactions: groupReactions(m.reactions),
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            senderName: m.replyTo.sender.displayName,
            senderNameAr: m.replyTo.sender.displayNameAr,
            // A withdrawn original must not leak its body through the quote.
            body: m.replyTo.deletedAt ? null : (m.replyTo.body ?? '').slice(0, 140),
            deleted: Boolean(m.replyTo.deletedAt),
            hasAttachments: m.replyTo._count.attachments > 0,
          }
        : null,
    }));

    return ok({
      messages,
      hasMore: rows.length === q.limit,
      oldestSeq: messages[0]?.seq ?? null,
    });
  } catch (err) {
    return handleError(err);
  }
}
