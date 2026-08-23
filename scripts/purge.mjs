// scripts/purge.mjs
// Retention sweep. Run nightly.
//
//   npm run purge:dry    # shows what WOULD be removed
//   npm run purge        # actually removes it
//
// Idempotent and safe to re-run. Every run writes an audit entry with counts.
//
// ⚠️ These periods may be constrained by law in your jurisdictions. The
//    defaults are a starting point, not a compliance position.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

const FILES_MONTHS = Number(process.env.RETENTION_FILES_MONTHS ?? 24);
const AUDIT_MONTHS = Number(process.env.RETENTION_AUDIT_MONTHS ?? 24);
const DELETED_DAYS = Number(process.env.RETENTION_PURGE_DELETED_DAYS ?? 30);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET ?? 'comms-files';
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d; };
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

const label = dryRun ? '[DRY RUN]' : '';
console.log(`\n${label} Retention sweep — ${new Date().toISOString()}\n`);

const counts = { messageBodies: 0, attachments: 0, objects: 0, auditRows: 0, setupTokens: 0, refreshTokens: 0 };

// ── 1. soft-deleted message bodies ──────────────────────────────────────────
// The ROW survives permanently — deleting it would break reply chains and
// leave dangling references. Only the body is cleared.
{
  const cutoff = daysAgo(DELETED_DAYS);
  const targets = await prisma.message.findMany({
    where: { deletedAt: { lt: cutoff }, body: { not: null } },
    select: { id: true },
  });
  counts.messageBodies = targets.length;

  if (targets.length > 0 && !dryRun) {
    await prisma.message.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { body: null, searchText: null },   // drop it from the index too
    });
  }
  console.log(`  ${counts.messageBodies} soft-deleted message body/bodies older than ${DELETED_DAYS} days`);
}

// ── 2. expired attachments ──────────────────────────────────────────────────
if (FILES_MONTHS > 0) {
  const cutoff = monthsAgo(FILES_MONTHS);
  const expired = await prisma.attachment.findMany({
    where: { createdAt: { lt: cutoff }, scanStatus: { not: 'purged' } },
    select: { id: true, storageKey: true, thumbnailKey: true, filename: true },
  });
  counts.attachments = expired.length;

  if (!dryRun) {
    for (const att of expired) {
      for (const key of [att.storageKey, att.thumbnailKey].filter(Boolean)) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
          counts.objects++;
        } catch (err) {
          // Already gone is fine. Anything else is worth seeing.
          if (err.name !== 'NoSuchKey') console.error(`  ! ${key}: ${err.message}`);
        }
      }
      // The row is kept with the object removed, so the message still shows
      // that a file was there — rather than a silent gap in the conversation.
      await prisma.attachment.update({
        where: { id: att.id },
        data: { scanStatus: 'purged', scanDetail: 'retention', thumbnailKey: null },
      });
    }
  }
  console.log(`  ${counts.attachments} attachment(s) older than ${FILES_MONTHS} months`);
} else {
  console.log('  file retention disabled (RETENTION_FILES_MONTHS=0)');
}

// ── 3. audit log ────────────────────────────────────────────────────────────
if (AUDIT_MONTHS > 0) {
  const cutoff = monthsAgo(AUDIT_MONTHS);
  counts.auditRows = await prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });

  if (counts.auditRows > 0 && !dryRun) {
    // ⚠️ Export before deleting if you have a retention obligation. This is
    //    the only copy.
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }
  console.log(`  ${counts.auditRows} audit row(s) older than ${AUDIT_MONTHS} months`);
} else {
  console.log('  audit retention disabled (RETENTION_AUDIT_MONTHS=0)');
}

// ── 4. spent tokens ─────────────────────────────────────────────────────────
{
  const now = new Date();
  counts.setupTokens = await prisma.setupToken.count({
    where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
  });
  counts.refreshTokens = await prisma.refreshToken.count({
    where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
  });

  if (!dryRun) {
    await prisma.setupToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    });
    // Consumed refresh tokens are kept until EXPIRY, not deleted on use —
    // reuse detection needs them present to spot a replayed token.
    await prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    });
  }
  console.log(`  ${counts.setupTokens} setup token(s), ${counts.refreshTokens} refresh token(s)`);
}

if (!dryRun) {
  await prisma.auditLog.create({
    data: { action: 'SYSTEM.RETENTION_PURGE', metadata: counts },
  });
}

console.log(dryRun
  ? '\n  Dry run. Re-run without --dry-run to apply.\n'
  : '\n  ✓ Sweep complete.\n');

await prisma.$disconnect();
