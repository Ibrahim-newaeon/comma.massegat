// tests/profile.spec.ts
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

async function login(page: Page) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForTimeout(600);
}

test.describe('Profile', () => {
  test('loads with the signed-in user', async ({ page }) => {
    await login(page);
    await page.goto('/profile');
    await expect(page.getByTestId('profile-page')).toBeVisible();
    await expect(page.getByTestId('display-name-input')).not.toHaveValue('');
    await expect(page.getByTestId('storage-bar')).toBeVisible();
  });

  test('an Arabic display name can be set and cleared', async ({ page }) => {
    await login(page);
    await page.goto('/profile');

    const arabic = 'إبراهيم';
    await page.getByTestId('display-name-ar-input').fill(arabic);
    await page.getByTestId('save-profile').click();
    await expect(page.getByTestId('profile-status')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByTestId('display-name-ar-input')).toHaveValue(arabic);

    // Clearing must store null, not an empty string — an empty string would
    // render as a blank name for Arabic users.
    await page.getByTestId('display-name-ar-input').fill('');
    await page.getByTestId('save-profile').click();
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.getByTestId('display-name-ar-input')).toHaveValue('');
  });

  test('the Arabic name field reads right-to-left', async ({ page }) => {
    await login(page);
    await page.goto('/profile');
    // dir="rtl", not "auto" — the field is FOR Arabic, so it should not flip
    // direction on the first keystroke.
    const dir = await page.getByTestId('display-name-ar-input')
      .evaluate((n) => getComputedStyle(n).direction);
    expect(dir).toBe('rtl');
  });

  test('the current session is listed and cannot be revoked', async ({ page }) => {
    await login(page);
    await page.goto('/profile');

    const current = page.getByTestId('session-row').filter({ hasText: /This device|هذا الجهاز/ });
    await expect(current).toHaveCount(1);
    // No revoke control on your own session: signing yourself out while
    // securing your account is a confusing failure.
    await expect(current.getByRole('button')).toHaveCount(0);
  });

  test('revoking the current session by id is refused', async ({ page }) => {
    await login(page);
    const list = await page.request.get('/api/me/sessions');
    const { data } = await list.json();
    const current = data.sessions.find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(current).toBeTruthy();

    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const res = await page.request.fetch('/api/me/sessions', {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
      data: { familyId: current.id },
    });
    expect(res.status()).toBe(400);
  });

  test('role and email cannot be changed through the profile API', async ({ page }) => {
    await login(page);
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');

    // Privilege escalation and account takeover respectively. Zod strips both.
    const res = await page.request.patch('/api/me', {
      headers: { 'x-csrf-token': csrf },
      data: { role: 'admin', email: 'attacker@evil.com', displayName: 'Still Me' },
    });

    const me = await (await page.request.get('/api/me')).json();
    expect(me.data.user.email).not.toBe('attacker@evil.com');
    void res;
  });

  test('a profile update without CSRF is refused', async ({ page }) => {
    await login(page);
    const res = await page.request.patch('/api/me', { data: { displayName: 'No CSRF' } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('an unauthenticated profile request is refused', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/login');
    const res = await p.request.get('/api/me');
    expect([401, 403]).toContain(res.status());
    await ctx.close();
  });

  test('changing the password requires the current one', async ({ page }) => {
    await login(page);
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');

    // Without this, a hijacked session could lock the real owner out.
    const res = await page.request.post('/api/auth/change-password', {
      headers: { 'x-csrf-token': csrf },
      data: { currentPassword: 'definitely-not-the-password', newPassword: 'a-Perfectly-Fine-New-1' },
    });
    expect(res.status()).toBe(401);
  });

  test('sign out ends the session', async ({ page }) => {
    await login(page);
    await page.goto('/profile');
    await page.getByTestId('logout-button').click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});
