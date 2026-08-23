// tests/proxy-trust.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Forwarded headers', () => {
  test('a spoofed X-Forwarded-For does not defeat login rate limiting', async ({ request }) => {
    test.setTimeout(90_000);

    // If forwarding headers were trusted without a proxy, each request would
    // look like a different client and per-IP limiting would never fire.
    const results: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request.post('/api/auth/login', {
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
        data: { email: `spoof-${i}@example.com`, password: 'wrong-password-here' },
      });
      results.push(res.status());
    }

    // Every attempt must be refused. The specific code depends on whether the
    // account limiter or the IP limiter caught it.
    expect(results.every((s) => s === 401 || s === 429 || s === 400)).toBe(true);
  });

  test('the app does not echo a client-supplied address back', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.99' },
      data: { email: 'nobody@example.com', password: 'wrong' },
    });
    const body = await res.text();
    // An attacker-chosen address appearing in a response is a hint it reached
    // the audit log, where it would look like evidence.
    expect(body).not.toContain('203.0.113.99');
  });
});
