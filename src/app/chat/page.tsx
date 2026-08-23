// src/app/chat/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { t } from '@/lib/i18n/dict';
import { ChatClient } from '@/components/chat/ChatClient';
import type { ChannelDTO } from '@/lib/chat/types';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');

  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const dict = t(locale);

  const memberships = await prisma.channelMember.findMany({
    where: { userId: user.id },
    include: {
      channel: {
        include: {
          members: { include: { user: { select: { id: true, displayName: true, displayNameAr: true } } } },
          messages: {
            orderBy: { seq: 'desc' },
            take: 1,
            // Only the newest message per channel — a preview must not cost a
            // second query per row.
            select: {
              createdAt: true, body: true, senderId: true, kind: true,
              sender: { select: { displayName: true } },
              _count: { select: { attachments: true } },
            },
          },
        },
      },
    },
  });

  const channels: ChannelDTO[] = await Promise.all(
    memberships.map(async (m) => ({
      id: m.channel.id,
      slug: m.channel.slug,
      name: m.channel.name,
      topic: m.channel.topic,
      type: m.channel.type as ChannelDTO['type'],
      unreadCount: await prisma.message.count({
        where: {
          channelId: m.channelId,
          seq: { gt: m.lastReadSeq },
          deletedAt: null,
          senderId: { not: user.id },
        },
      }),
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
      peer: m.channel.type === 'dm'
        ? (m.channel.members.find((x) => x.userId !== user.id)?.user ?? null)
        : null,
    })),
  );

  channels.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

  const peers = await prisma.user.findMany({
    where: { isActive: true, id: { not: user.id } },
    select: { id: true, displayName: true, displayNameAr: true },
    orderBy: { displayName: 'asc' },
  });

  return (
    <div className="flex h-screen flex-col">
      <ChatClient
        dict={dict}
        locale={locale}
        peers={peers}
        me={{ id: user.id, role: user.role, displayName: user.displayName }}
        initialChannels={channels}
      />
    </div>
  );
}
