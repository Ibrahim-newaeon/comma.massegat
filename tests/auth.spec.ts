// tests/auth.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

test.describe('Authentication — positive', () => {
  test('admin can sign in', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('access cookie is httpOnly and not readable from JS', async ({ page, context }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForTimeout(500);

    const cookies = await context.cookies('http://localhost:3000');
    const access = cookies.find((c) => c.name === 'cp_access');
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe('Strict');

    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('cp_access');
  });
});

test.describe('Authentication — negative', () => {
  test('wrong password gives a generic error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginRaw(ADMIN_EMAIL, 'definitely-the-wrong-password');
    await login.expectGenericError();
  });

  test('nonexistent account gives the SAME error as a wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginRaw('nobody-here@example.com', 'whatever-password-123');
    await login.expectGenericError();
  });

  test('malformed payload is rejected by Zod with no stack trace', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { email: 'not-an-email' } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body)).not.toContain('at ');   // no stack frames
    expect(JSON.stringify(body)).not.toContain('node_modules');
  });

  test('rate limit trips after repeated failures', async ({ request }) => {
    const email = `ratelimit-probe-${Date.now()}@example.com`;
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const res = await request.post('/api/auth/login', {
        data: { email, password: 'wrong-password-attempt' },
      });
      if (res.status() === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });

  test('unauthenticated API call is rejected', async ({ request }) => {
    const res = await request.get('/api/admin/users');
    expect([401, 403]).toContain(res.status());
  });

  test('mutation without CSRF header is rejected', async ({ request }) => {
    const res = await request.post('/api/auth/logout', { data: {} });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('Refresh token rotation', () => {
  test('reused refresh token revokes the whole family', async ({ page, context, request }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForTimeout(500);

    // cp_refresh is scoped to Path=/api/auth — the origin alone will not match.
    const cookies = await context.cookies('http://localhost:3000/api/auth/refresh');
    const original = cookies.find((c) => c.name === 'cp_refresh')?.value;
    expect(original).toBeTruthy();

    // First rotation consumes the original token — should succeed.
    const first = await page.request.post('/api/auth/refresh');
    expect(first.ok()).toBe(true);

    // Replaying the ORIGINAL token = leak signal. Must be rejected.
    const replay = await request.post('/api/auth/refresh', {
      headers: { cookie: `cp_refresh=${original}` },
    });
    expect(replay.status()).toBe(401);
    const body = await replay.json();
    expect(body.error.reason).toBe('reuse_detected');
  });
});

test.describe('Health endpoints', () => {
  test('healthz responds and leaks nothing', async ({ request }) => {
    const res = await request.get('/api/healthz');
    expect(res.ok()).toBe(true);
    const text = await res.text();
    expect(text).not.toMatch(/postgres|redis|password|secret/i);
  });

  test('readyz reports dependency status', async ({ request }) => {
    const res = await request.get('/api/readyz');
    const body = await res.json();
    expect(body.checks).toHaveProperty('database');
    expect(body.checks).toHaveProperty('redis');
  });
});
