// scripts/backfill-search.mjs
// Populates search_text for messages that predate Phase 4.
// Without this, everything sent before search existed is unfindable.
//   node scripts/backfill-search.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function toSearchText(body) {
  if (!body) return null;
  const n = body
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return n.length > 0 ? n : null;
}

const BATCH = 500;
let processed = 0;

// Batched: a channel with 100k messages would otherwise be one enormous
// transaction holding locks for the duration.
for (;;) {
  const rows = await prisma.message.findMany({
    where: { searchText: null, body: { not: null }, deletedAt: null },
    select: { id: true, body: true },
    take: BATCH,
  });
  if (rows.length === 0) break;

  await prisma.$transaction(
    rows.map((r) => prisma.message.update({
      where: { id: r.id },
      data: { searchText: toSearchText(r.body) },
    })),
  );

  processed += rows.length;
  console.log(`  ${processed} message(s) indexed`);
}

console.log(processed === 0 ? '  Nothing to backfill.' : `\n  ✓ ${processed} message(s) indexed.`);
await prisma.$disconnect();
