// src/lib/redis.ts
import Redis from 'ioredis';
import { env } from '@/env';

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

redis.on('error', (err) => {
  console.error('[redis] connection error', { message: err.message });
});
