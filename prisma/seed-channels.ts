// prisma/seed-channels.ts
// Creates the company-wide channel and backfills membership. Idempotent.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const GENERAL_SLUG = 'general';

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
  if (!admin) { console.error('✗ No admin found. Run db:seed first.'); process.exit(1); }

  let channel = await prisma.channel.findUnique({ where: { slug: GENERAL_SLUG } });
  if (!channel) {
    channel = await prisma.channel.create({
      data: {
        slug: GENERAL_SLUG,
        name: 'General',
        topic: 'Company-wide announcements and discussion',
        type: 'public',
        createdBy: admin.id,
      },
    });
    console.log('✓ Created #general');
  } else {
    console.log('✓ #general already exists');
  }

  // Backfill every active user.
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  const result = await prisma.channelMember.createMany({
    data: users.map((u) => ({ channelId: channel!.id, userId: u.id })),
    skipDuplicates: true,
  });
  console.log(`✓ ${result.count} member(s) added to #general (${users.length} active users)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
