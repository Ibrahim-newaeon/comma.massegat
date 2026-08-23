// tests/signup.spec.ts
import { test, expect } from '@playwright/test';

const ALLOWED = process.env.SIGNUP_ALLOWED_DOMAINS ?? '';
const firstDomain = ALLOWED.split(',')[0]?.trim().replace(/^@/, '') ?? '';

test.describe('Signup', () => {
  test.skip(ALLOWED === '', 'signup disabled — SIGNUP_ALLOWED_DOMAINS is empty');

  test('a disallowed domain is refused', async ({ request }) => {
    const res = await request.post('/api/auth/signup', {
      data: {
        email: `outsider-${Date.now()}@gmail.com`,
        displayName: 'Outsider',
        password: 'a-Perfectly-Fine-Password-1',
      },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  test('an allowed domain registers as PENDING, not active', async ({ request }) => {
    const email = `signup-${Date.now()}@${firstDomain}`;
    const res = await request.post('/api/auth/signup', {
      data: { email, displayName: 'Signup Test', password: 'a-Perfectly-Fine-Password-1' },
    });
    expect(res.ok()).toBe(true);

    // The account exists but must not be usable until an admin approves it.
    const login = await request.post('/api/auth/login', {
      data: { email, password: 'a-Perfectly-Fine-Password-1' },
    });
    expect(login.status()).toBe(403);
    expect((await login.json()).error.code).toBe('ACCOUNT_PENDING');
  });

  test('a duplicate registration is indistinguishable from a new one', async ({ request }) => {
    const email = `dupe-${Date.now()}@${firstDomain}`;
    const body = { email, displayName: 'Dupe', password: 'a-Perfectly-Fine-Password-1' };

    const first = await request.post('/api/auth/signup', { data: body });
    const second = await request.post('/api/auth/signup', { data: body });

    // Differing here would turn the endpoint into an account-enumeration
    // oracle — useful for phishing, worthless to a legitimate user.
    expect(second.status()).toBe(first.status());
    expect(await second.text()).toBe(await first.text());
  });

  test('signup can never mint an admin', async ({ request }) => {
    const email = `escalate-${Date.now()}@${firstDomain}`;
    // role is not in the schema, so Zod strips it — but assert the outcome,
    // not the mechanism.
    await request.post('/api/auth/signup', {
      data: {
        email, displayName: 'Escalation', password: 'a-Perfectly-Fine-Password-1',
        role: 'admin', isActive: true, approvalStatus: 'approved',
      },
    });

    const login = await request.post('/api/auth/login', {
      data: { email, password: 'a-Perfectly-Fine-Password-1' },
    });
    // Still pending: the injected approvalStatus was ignored.
    expect(login.status()).toBe(403);
  });

  test('a breached password is refused', async ({ request }) => {
    const res = await request.post('/api/auth/signup', {
      data: {
        email: `breach-${Date.now()}@${firstDomain}`,
        displayName: 'Breach',
        password: 'Password123456',
      },
    });
    expect([400, 403]).toContain(res.status());
  });

  test('repeated attempts are rate limited', async ({ request }) => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request.post('/api/auth/signup', {
        data: {
          email: `flood-${Date.now()}-${i}@${firstDomain}`,
          displayName: 'Flood',
          password: 'a-Perfectly-Fine-Password-1',
        },
      });
      codes.push(res.status());
    }
    // A signup form on a public URL writes rows and hashes passwords — both
    // expensive, and the most attractive endpoint in the app.
    expect(codes).toContain(429);
  });
});

test.describe('Signup — disabled by default', () => {
  test.skip(ALLOWED !== '', 'signup is enabled in this environment');

  test('the endpoint refuses when no domains are configured', async ({ request }) => {
    const res = await request.post('/api/auth/signup', {
      data: { email: 'anyone@anywhere.com', displayName: 'X', password: 'a-Perfectly-Fine-Password-1' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('SIGNUP_DISABLED');
  });

  test('the page redirects rather than advertising a dead route', async ({ page }) => {
    await page.goto('/signup');
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});
