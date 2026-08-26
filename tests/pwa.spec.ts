import { test, expect } from '@playwright/test';

test.describe('App store verification files', () => {
  test('assetlinks.json is reachable WITHOUT a session', async ({ request }) => {
    // Google fetches this unauthenticated. Behind the auth gate it receives a
    // redirect, verification fails silently, and the TWA ships with a visible
    // address bar — which defeats the entire point of wrapping it.
    const res = await request.get('/.well-known/assetlinks.json');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].target.namespace).toBe('android_app');
  });

  test('the signing fingerprint is not still a placeholder', async ({ request }) => {
    const res = await request.get('/.well-known/assetlinks.json');
    const body = await res.json();
    const fp = body[0].target.sha256_cert_fingerprints[0];
    // Shipping the placeholder means the address bar appears for every user.
    expect(fp).not.toContain('REPLACE_WITH');
  });

  test('the manifest declares what an installable app needs', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    // Without a maskable icon Android renders the app icon in a white circle.
    expect(m.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'))).toBe(true);
  });
});
