// src/lib/ratelimit.ts
import { redis } from '@/lib/redis';

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/** Fixed-window counter in Redis. Fails OPEN on Redis error — availability over strictness. */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const redisKey = `rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds);
    const ttl = await redis.ttl(redisKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (err) {
    console.error('[RATELIMIT] Redis unavailable, failing open', err);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export const LIMITS = {
  LOGIN_PER_ACCOUNT: { limit: 5, window: 900 },  // 5 per 15 min
  // An office shares one public IP. 20 per 15 min locks out the whole company
  // on a normal morning. Per-ACCOUNT lockout (5 failures) is the real defence
  // against credential stuffing; this only needs to stop a machine-speed flood.
  LOGIN_PER_IP: { limit: 200, window: 900 },
  REFRESH_PER_USER: { limit: 60, window: 3600 },
  TOTP_PER_USER: { limit: 10, window: 900 },
  ADMIN_MUTATION: { limit: 60, window: 3600 },
} as const;
