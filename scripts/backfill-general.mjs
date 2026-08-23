// backfill-general.mjs
// Adds every active, approved user to #general.
//
// Covers accounts that predate the auto-join, and any created by a path that
// missed it. Idempotent — safe to run repeatedly.
//
//   node backfill-general.mjs            # report only
//   node backfill-general.mjs --apply    # actually add them
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const general = await prisma.channel.findFirst({ where: { slug: 'general' } });
if (!general) {
  console.log('No #general channel found. Run npm run db:setup first.');
  process.exit(1);
}

const missing = await prisma.user.findMany({
  where: {
    isActive: true,
    approvalStatus: 'approved',
    // A pending account with channel membership would receive messages before
    // anyone approved it.
    channelMembers: { none: { channelId: general.id } },
  },
  select: { id: true, email: true, displayName: true },
});

if (missing.length === 0) {
  console.log('Everyone is already in #general.');
} else {
  console.log(`${missing.length} user(s) not in #general:\n`);
  for (const u of missing) console.log(`  ${u.displayName}  <${u.email}>`);

  if (apply) {
    await prisma.channelMember.createMany({
      data: missing.map((u) => ({ channelId: general.id, userId: u.id })),
      skipDuplicates: true,
    });
    console.log(`\n✓ Added ${missing.length} user(s).`);
  } else {
    console.log('\nRe-run with --apply to add them.');
  }
}

await prisma.$disconnect();
