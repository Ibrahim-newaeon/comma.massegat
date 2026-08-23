// src/app/api/channels/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { ok, fail, handleError } from '@/lib/http';
import type { ChannelDTO } from '@/lib/chat/types';

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const memberships = await prisma.channelMember.findMany({
      where: { userId: actor.id },
      include: {
        channel: {
          include: {
            members: { include: { user: { select: { id: true, displayName: true, displayNameAr: true } } } },
            messages: {
              orderBy: { seq: 'desc' },
              take: 1,
              // Same fields the chat page selects. Two endpoints build the
              // same DTO; if they diverge, previews appear on load and vanish
              // after a refresh.
              select: {
                seq: true, createdAt: true, body: true, senderId: true, kind: true,
                sender: { select: { displayName: true } },
                _count: { select: { attachments: true } },
              },
            },
          },
        },
      },
    });

    const channels: ChannelDTO[] = await Promise.all(
      memberships.map(async (m) => {
        // Unread = messages above the member's read watermark, excluding own.
        const unreadCount = await prisma.message.count({
          where: {
            channelId: m.channelId,
            seq: { gt: m.lastReadSeq },
            deletedAt: null,
            senderId: { not: actor.id },
          },
        });

        const peer =
          m.channel.type === 'dm'
            ? (m.channel.members.find((x) => x.userId !== actor.id)?.user ?? null)
            : null;

        return {
          id: m.channel.id,
          slug: m.channel.slug,
          name: m.channel.name,
          topic: m.channel.topic,
          type: m.channel.type as ChannelDTO['type'],
          unreadCount,
          lastMessageAt: m.channel.messages[0]?.createdAt.toISOString() ?? null,
          lastMessage: m.channel.messages[0]
            ? {
                body: m.channel.messages[0].body,
                senderId: m.channel.messages[0].senderId,
                senderName: m.channel.messages[0].sender.displayName,
                kind: m.channel.messages[0].kind,
                attachmentCount: m.channel.messages[0]._count.attachments,
              }
            : null,
          peer,
        };
      }),
    );

    channels.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
    return ok({ channels });
  } catch (err) {
    return handleError(err);
  }
}
