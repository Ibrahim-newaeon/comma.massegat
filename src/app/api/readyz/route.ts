// src/app/api/readyz/route.ts
// Readiness. Checks dependencies but leaks no connection details.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { headObject } from '@/lib/files/storage';
import { pingClamav } from '@/lib/files/clamav';

export async function GET() {
  const checks = { database: false, redis: false, storage: false, scanner: false, sfu: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch { /* leave false */ }

  try {
    await redis.ping();
    checks.redis = true;
  } catch { /* leave false */ }

  try {
    // HEAD on a key that will not exist still proves the bucket answers.
    await headObject('__readyz_probe__');
    checks.storage = true;
  } catch { /* leave false */ }

  checks.scanner = await pingClamav().catch(() => false);

  try {
    const u = new URL(process.env.LIVEKIT_URL ?? '');
    const httpUrl = `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}/`;
    const r = await fetch(httpUrl, { signal: AbortSignal.timeout(2000) });
    checks.sfu = r.status < 500;
  } catch { /* leave false */ }

  // Storage, scanner and SFU are NOT required for readiness — chat keeps
  // working without them. Files and calls degrade; the app does not go down.
  const ready = checks.database && checks.redis;
  return Response.json({ status: ready ? 'ready' : 'not_ready', checks }, { status: ready ? 200 : 503 });
}
