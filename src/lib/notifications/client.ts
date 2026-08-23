'use client';
// src/lib/notifications/client.ts
import { csrfToken } from '@/lib/csrfClient';

/** Base64url → Uint8Array. The Push API will not take the string form. */
/**
 * Typed Uint8Array<ArrayBuffer>, not plain Uint8Array: since TS 5.7 the
 * default admits SharedArrayBuffer and therefore does not satisfy the DOM's
 * BufferSource. Allocating the buffer explicitly makes the type concrete.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function pushPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); }
  catch { return null; }
}

/**
 * Requests permission and subscribes.
 *
 * Called ONLY from a click. Browsers reject a permission prompt that is not
 * tied to a user gesture, and a prompt on page load is the fastest way to get
 * permanently denied — the denial is sticky and there is no second chance.
 */
export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const registration = await registerServiceWorker();
  if (!registration) return { ok: false, reason: 'sw-failed' };

  try {
    const res = await fetch('/api/push/vapid');
    const json = await res.json();
    if (!json.ok) return { ok: false, reason: 'not-configured' };

    const subscription = await registration.pushManager.subscribe({
      // Chrome requires this. A silent push would let a site track a user
      // without ever showing anything.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(json.data.publicKey),
    });

    const save = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify(subscription.toJSON()),
    });

    return save.ok ? { ok: true } : { ok: false, reason: 'save-failed' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});

  await subscription.unsubscribe().catch(() => {});
}
