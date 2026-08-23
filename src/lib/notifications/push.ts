// src/lib/notifications/push.ts
import webpush from 'web-push';
import { prisma } from '@/lib/db';
import { env } from '@/env';

let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  channelId: string;
  /** 'ltr' | 'rtl' — set per RECIPIENT locale, not the sender's. */
  dir: 'ltr' | 'rtl';
  lang: string;
};

/**
 * Sends to every device a user has registered.
 *
 * A 404 or 410 means the browser has discarded the subscription — the user
 * cleared site data or uninstalled. Those rows are deleted rather than retried
 * forever; otherwise the table fills with dead endpoints and every send waits
 * on them.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!configure()) return 0;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return 0;

  let delivered = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      delivered++;
      await prisma.pushSubscription.update({
        where: { id: sub.id }, data: { lastUsedAt: new Date() },
      }).catch(() => { /* not worth failing a send over */ });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        console.error('[push] send failed', status, (err as Error).message);
      }
    }
  }));

  return delivered;
}
