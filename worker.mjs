// worker.mjs
// Scan worker. Pulls attachment ids off a Redis list, scans the object with
// ClamAV, generates a thumbnail if the file is an image, and deletes anything
// infected from storage.
//
// Runs as its own process so a scan that hangs cannot block HTTP requests, and
// so it can be restarted independently.
//
// Uses BRPOPLPUSH: the id moves to a processing list rather than disappearing,
// so a worker that dies mid-scan does not silently lose the job.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import net from 'node:net';
import sharp from 'sharp';
import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL);
const blocking = redis.duplicate();

const BUCKET = process.env.S3_BUCKET ?? 'comms-files';
const CLAMAV_ENABLED = process.env.CLAMAV_ENABLED !== 'false';
const SCAN_QUEUE = 'queue:scan';
const SCAN_PROCESSING = 'queue:scan:processing';

const s3 = new S3Client({
  // The worker DOWNLOADS every object to scan it. Routing that through a
  // public hostname sends each file out to the CDN and back through the tunnel
  // to reach a container beside it — slow, fragile, and billable.
  endpoint: process.env.S3_INTERNAL_ENDPOINT || process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

const THUMBNAILABLE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

// ── ClamAV INSTREAM ─────────────────────────────────────────────────────────
function scanBuffer(buf, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let response = '';
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; socket.destroy(); resolve(r); };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish({ status: 'error', detail: 'SCAN_TIMEOUT' }));
    socket.on('error', (e) => finish({ status: 'error', detail: e.message }));
    socket.on('data', (d) => { response += d.toString('utf8'); });
    socket.on('close', () => {
      const text = response.replace(/\0/g, '').trim();
      if (!text) return finish({ status: 'error', detail: 'EMPTY_RESPONSE' });
      if (text.endsWith('OK')) return finish({ status: 'clean' });
      if (text.includes('FOUND')) {
        return finish({
          status: 'infected',
          signature: text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') || 'UNKNOWN',
        });
      }
      finish({ status: 'error', detail: text });
    });

    socket.connect(Number(process.env.CLAMAV_PORT ?? 3310), process.env.CLAMAV_HOST ?? 'localhost', () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let off = 0; off < buf.length; off += CHUNK) {
        const chunk = buf.subarray(off, Math.min(off + CHUNK, buf.length));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length, 0);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

async function getBytes(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const c of r.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

/**
 * Tells the socket server a scan finished, so connected clients update without
 * a reload. The worker is a separate process and cannot reach io directly —
 * Redis pub/sub is the bridge, and the same channel works unchanged if the
 * worker is ever moved to another machine.
 */
async function publishScanResult(att, scanStatus, scanDetail, hasThumbnail = false) {
  try {
    await redis.publish('attachment:scanned', JSON.stringify({
      attachmentId: att.id,
      channelId: att.channelId,
      messageId: att.messageId,
      scanStatus,
      scanDetail,
      hasThumbnail,
    }));
  } catch (err) {
    // A missed notification is cosmetic — the status is already in the
    // database and a reload will show it. Never fail the scan over this.
    console.error('  ! could not publish scan result:', err.message);
  }
}

// ── job ─────────────────────────────────────────────────────────────────────
// NOT named `process` — a function declaration by that name shadows Node's
// global `process` object for the whole module, so `process.env` reads as
// undefined. It parses fine and passes `node --check`; it fails only at runtime.
async function handleJob(attachmentId) {
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!att) return console.log(`  [${attachmentId}] gone — skipping`);
  if (att.scanStatus !== 'pending') return console.log(`  [${attachmentId}] already ${att.scanStatus}`);

  const label = `${att.filename} (${(Number(att.sizeBytes) / 1024).toFixed(0)} KB)`;
  console.log(`  scanning ${label}`);

  let bytes;
  try {
    bytes = await getBytes(att.storageKey);
  } catch (e) {
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: 'error', scanDetail: `FETCH_FAILED: ${e.message}`, scannedAt: new Date() },
    });
    return console.error(`  ✗ could not fetch ${label}: ${e.message}`);
  }

  const result = CLAMAV_ENABLED
    ? await scanBuffer(bytes)
    : { status: 'error', detail: 'CLAMAV_DISABLED' };

  if (result.status === 'infected') {
    // Delete the object, not just the flag. A flag can be bypassed by anything
    // that later reads storage directly.
    try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: att.storageKey })); }
    catch (e) { console.error(`  ! object delete failed: ${e.message}`); }

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: 'infected', scanDetail: result.signature, scannedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        actorId: att.uploaderId, action: 'FILE.INFECTED',
        targetType: 'attachment', targetId: attachmentId,
        metadata: { filename: att.filename, signature: result.signature },
      },
    });
    await publishScanResult(att, 'infected', result.signature);
    return console.log(`  ⚠ INFECTED ${label} — ${result.signature}, object deleted`);
  }

  if (result.status === 'error') {
    // Fail CLOSED. An unscanned file stays undownloadable.
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: 'error', scanDetail: result.detail, scannedAt: new Date() },
    });
    await publishScanResult(att, 'error', result.detail);
    return console.error(`  ✗ scan error on ${label}: ${result.detail}`);
  }

  let thumbnailKey = null;
  if (THUMBNAILABLE.has(att.mimeType)) {
    try {
      const thumb = await sharp(bytes).resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 }).toBuffer();
      thumbnailKey = `${att.storageKey}.thumb.webp`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: thumbnailKey, Body: thumb, ContentType: 'image/webp',
      }));
    } catch (e) {
      // A thumbnail is a nicety. Its failure must not block a clean file.
      console.error(`  ! thumbnail failed for ${label}: ${e.message}`);
      thumbnailKey = null;
    }
  }

  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { scanStatus: 'clean', scanDetail: null, scannedAt: new Date(), thumbnailKey },
  });
  await publishScanResult(att, 'clean', null, Boolean(thumbnailKey));
  console.log(`  ✓ clean ${label}${thumbnailKey ? ' (+thumbnail)' : ''}`);
}

// ── loop ────────────────────────────────────────────────────────────────────
let running = true;

async function recoverOrphans() {
  // Jobs left in the processing list by a worker that died mid-scan.
  const orphans = await redis.lrange(SCAN_PROCESSING, 0, -1);
  if (orphans.length === 0) return;
  console.log(`> recovering ${orphans.length} interrupted job(s)`);
  for (const id of orphans) {
    await redis.lrem(SCAN_PROCESSING, 1, id);
    await redis.lpush(SCAN_QUEUE, id);
  }
}

async function main() {
  console.log('> scan worker started');
  console.log(`> clamav ${CLAMAV_ENABLED ? `${process.env.CLAMAV_HOST}:${process.env.CLAMAV_PORT}` : 'DISABLED'}`);
  if (!CLAMAV_ENABLED) {
    console.warn('⚠ CLAMAV_ENABLED=false — uploads will be marked error and stay undownloadable.');
  }

  await recoverOrphans();

  while (running) {
    try {
      // Atomic move to the processing list — a crash mid-scan loses nothing.
      const id = await blocking.brpoplpush(SCAN_QUEUE, SCAN_PROCESSING, 5);
      if (!id) continue;
      try { await handleJob(id); }
      finally { await redis.lrem(SCAN_PROCESSING, 1, id); }
    } catch (e) {
      if (running) { console.error('worker loop error:', e.message); await new Promise((r) => setTimeout(r, 2000)); }
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n${sig} — draining`);
    running = false;
    await Promise.allSettled([blocking.quit(), redis.quit(), prisma.$disconnect()]);
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
