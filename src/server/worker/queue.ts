// src/server/worker/queue.ts
import { redis } from '@/lib/redis';

export const SCAN_QUEUE = 'queue:scan';
export const SCAN_PROCESSING = 'queue:scan:processing';

/** Enqueue an attachment for virus scanning. */
export async function enqueueScan(attachmentId: string): Promise<void> {
  await redis.lpush(SCAN_QUEUE, attachmentId);
}

export async function queueDepth(): Promise<number> {
  return redis.llen(SCAN_QUEUE);
}
