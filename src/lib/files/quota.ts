// src/lib/files/quota.ts
import { prisma } from '@/lib/db';
import { env } from '@/env';

export type QuotaUsage = { usedBytes: number; limitBytes: number; remainingBytes: number };

/**
 * Counts everything not rejected — including pending scans. Otherwise a user
 * could queue unlimited uploads faster than the scanner clears them.
 */
const COUNTED = { notIn: ['rejected', 'error'] };

export async function userUsage(userId: string): Promise<QuotaUsage> {
  const r = await prisma.attachment.aggregate({
    where: { uploaderId: userId, scanStatus: COUNTED },
    _sum: { sizeBytes: true },
  });
  const used = Number(r._sum.sizeBytes ?? 0n);
  return {
    usedBytes: used,
    limitBytes: env.USER_QUOTA_BYTES,
    remainingBytes: Math.max(0, env.USER_QUOTA_BYTES - used),
  };
}

export async function channelUsage(channelId: string): Promise<QuotaUsage> {
  const r = await prisma.attachment.aggregate({
    where: { channelId, scanStatus: COUNTED },
    _sum: { sizeBytes: true },
  });
  const used = Number(r._sum.sizeBytes ?? 0n);
  return {
    usedBytes: used,
    limitBytes: env.CHANNEL_QUOTA_BYTES,
    remainingBytes: Math.max(0, env.CHANNEL_QUOTA_BYTES - used),
  };
}

export type QuotaCheck = { ok: true } | { ok: false; code: string; message: string };

/** Checked BEFORE issuing a presigned URL — never after the bytes have landed. */
export async function checkQuota(userId: string, channelId: string, sizeBytes: number): Promise<QuotaCheck> {
  const [user, channel] = await Promise.all([userUsage(userId), channelUsage(channelId)]);

  if (sizeBytes > user.remainingBytes) {
    return {
      ok: false, code: 'USER_QUOTA_EXCEEDED',
      message: `This would exceed your storage limit. ${formatBytes(user.remainingBytes)} remaining.`,
    };
  }
  if (sizeBytes > channel.remainingBytes) {
    return {
      ok: false, code: 'CHANNEL_QUOTA_EXCEEDED',
      message: `This would exceed the channel storage limit. ${formatBytes(channel.remainingBytes)} remaining.`,
    };
  }
  return { ok: true };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(2)} GB`;
}
