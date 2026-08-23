// src/app/api/channels/[id]/media/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { ok, fail, handleError } from '@/lib/http';

const QuerySchema = z.object({
  tab: z.enum(['media', 'docs', 'links']).default('media'),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

/** Bare enough that a URL inside Arabic text is still caught. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const { id: channelId } = await params;
    const q = QuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

    // Membership first. Without this the gallery is a way to read the file
    // list of any channel by guessing an id — the messages would be protected
    // while their attachments were not.
    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: actor.id } },
    });
    if (!member) return fail('FORBIDDEN', 'Not a member of this channel', 403);

    if (q.tab === 'links') {
      // Links are not stored as rows — they are extracted from message bodies
      // on read. Indexing them would mean a second write path to keep in step
      // with edits and deletions, for a view most people open rarely.
      const messages = await prisma.message.findMany({
        where: { channelId, deletedAt: null, kind: 'user', body: { contains: 'http' } },
        orderBy: { seq: 'desc' },
        take: 200,
        select: {
          id: true, body: true, createdAt: true,
          sender: { select: { displayName: true } },
        },
      });

      const seen = new Set<string>();
      const links: { url: string; messageId: string; senderName: string; createdAt: string }[] = [];

      for (const m of messages) {
        for (const url of m.body?.match(URL_PATTERN) ?? []) {
          // The same link posted five times is one entry, newest first.
          if (seen.has(url)) continue;
          seen.add(url);
          links.push({
            url,
            messageId: m.id,
            senderName: m.sender.displayName,
            createdAt: m.createdAt.toISOString(),
          });
          if (links.length >= q.limit) break;
        }
        if (links.length >= q.limit) break;
      }

      return ok({ tab: 'links', items: links });
    }

    const isMedia = q.tab === 'media';

    const attachments = await prisma.attachment.findMany({
      where: {
        channelId,
        // Infected and purged files must not appear even as a name — a
        // quarantined item listed in a gallery invites someone to ask for it.
        scanStatus: 'clean',
        mimeType: isMedia
          ? { startsWith: 'image/' }
          : { not: { startsWith: 'image/' } },
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        createdAt: true, messageId: true, thumbnailKey: true,
        uploader: { select: { displayName: true } },
      },
    });

    return ok({
      tab: q.tab,
      items: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: Number(a.sizeBytes),
        createdAt: a.createdAt.toISOString(),
        messageId: a.messageId,
        uploaderName: a.uploader.displayName,
        hasThumbnail: Boolean(a.thumbnailKey),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
