// scripts/cleanup-test-data.mjs
// Removes accounts left behind by the Playwright suite. Each run of
// chat.spec.ts and rbac.spec.ts provisions fresh users; they accumulate and
// then clutter DM pickers and channel lists.
//
//   node scripts/cleanup-test-data.mjs            # dry run — shows what would go
//   node scripts/cleanup-test-data.mjs --confirm  # actually deletes
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config();
const prisma = new PrismaClient();
const confirmed = process.argv.includes('--confirm');

// Only prefixes the test suite generates. Deliberately narrow — never a
// wildcard, never anything that could match a real account.
const TEST_PREFIXES = ['peer-', 'deactivate-', 'member-', 'audited-', 'wrong-pw-', 'ratelimit-probe-'];

const users = await prisma.user.findMany({
  where: { OR: TEST_PREFIXES.map((p) => ({ email: { startsWith: p } })) },
  select: { id: true, email: true, role: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
});

if (users.length === 0) {
  console.log('No test accounts found. Nothing to do.');
  await prisma.$disconnect();
  process.exit(0);
}

// Refuse to touch an admin, however it was named.
const admins = users.filter((u) => u.role === 'admin');
if (admins.length > 0) {
  console.error('✗ Refusing to run — these matched but hold the admin role:');
  for (const a of admins) console.error(`    ${a.email}`);
  console.error('  Rename or demote them first.');
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`Found ${users.length} test account(s):\n`);
for (const u of users) console.log(`  ${u.createdAt.toISOString().slice(0, 16)}  ${u.email}`);

if (!confirmed) {
  console.log('\nDry run. Re-run with --confirm to delete these and their messages.');
  await prisma.$disconnect();
  process.exit(0);
}

const ids = users.map((u) => u.id);

// Cascades handle identities, tokens, and channel membership. Messages
// reference the sender without cascade, so they go first.
const msgs = await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
const dms = await prisma.channel.deleteMany({
  where: { type: 'dm', members: { some: { userId: { in: ids } } } },
});
const deleted = await prisma.user.deleteMany({ where: { id: { in: ids } } });

console.log(`\n✓ ${deleted.count} account(s), ${msgs.count} message(s), ${dms.count} DM channel(s) removed`);
await prisma.$disconnect();
