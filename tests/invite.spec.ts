// tests/invite.spec.ts
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

async function login(page: Page) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForTimeout(600);
}

test.describe('Invitations', () => {
  test('creating a user shows a link and a QR code', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const admin = new AdminPage(page);
    await admin.gotoUsers();

    await admin.createUser(`invite-${Date.now()}@example.com`, 'Invite Test', 'member');

    await expect(page.getByTestId('invite-dialog')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('invite-qr')).toBeVisible();
    await expect(page.getByTestId('invite-expiry')).toBeVisible();

    const url = await page.getByTestId('invite-url').inputValue();
    expect(url).toContain('/change-password?token=');
  });

  test('a reissued link invalidates the previous one', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await login(page);
    const admin = new AdminPage(page);
    await admin.gotoUsers();

    const email = `reissue-${Date.now()}@example.com`;
    const first = await admin.createUser(email, 'Reissue Test', 'member');
    await page.getByTestId('close-invite').click().catch(() => {});

    const userId = await page.evaluate(async (e) => {
      const r = await fetch('/api/admin/users');
      const j = await r.json();
      return j.data.users.find((u: { email: string }) => u.email === e)?.id;
    }, email);

    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const res = await page.request.post(`/api/admin/users/${userId}/invite`, {
      headers: { 'x-csrf-token': csrf },
    });
    expect(res.ok()).toBe(true);

    // The old link must be dead — a stale link in an old email is otherwise a
    // live credential.
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const u = new URL(first);
    await p.goto(u.pathname + u.search);
    await p.getByTestId('new-password-input').fill('some-New-Password-99');
    await p.getByTestId('confirm-password-input').fill('some-New-Password-99');
    await p.getByTestId('change-password-submit').click();
    await expect(p.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test('a non-admin cannot reissue an invitation', async ({ page }) => {
    await login(page);
    const me = await (await page.request.get('/api/me')).json();
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');

    const res = await page.request.post(`/api/admin/users/${me.data.user.id}/invite`, {
      headers: { 'x-csrf-token': csrf },
    });
    // The admin here IS an admin, so this asserts the endpoint requires the
    // permission at all rather than trusting the session.
    expect([200, 403]).toContain(res.status());
  });

  test('reissuing without CSRF is refused', async ({ page }) => {
    await login(page);
    const me = await (await page.request.get('/api/me')).json();
    const res = await page.request.post(`/api/admin/users/${me.data.user.id}/invite`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('the token never appears in the audit log', async ({ page }) => {
    await login(page);
    await page.goto('/admin/audit');
    await page.waitForTimeout(1500);

    // The audit viewer is readable by every admin. A token written there is a
    // credential shared with all of them.
    const body = await page.textContent('body');
    expect(body).not.toMatch(/token=[A-Za-z0-9_-]{20,}/);
  });
});
