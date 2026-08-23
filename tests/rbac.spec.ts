// tests/rbac.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';
const MEMBER_PASSWORD = 'member-password-for-tests-1';

async function loginAs(page: import('@playwright/test').Page, email: string, password: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await page.waitForTimeout(500);
}

test.describe('RBAC — member is denied admin capabilities', () => {
  let memberEmail: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const admin = new AdminPage(page);
    await admin.gotoUsers();
    memberEmail = `member-${Date.now()}@example.com`;
    const setupUrl = await admin.createUser(memberEmail, 'Test Member', 'member', 'عضو تجريبي');

    // Complete setup so the member can sign in.
    await page.goto(new URL(setupUrl).pathname + new URL(setupUrl).search);
    await page.getByTestId('new-password-input').fill(MEMBER_PASSWORD);
    await page.getByTestId('confirm-password-input').fill(MEMBER_PASSWORD);
    await page.getByTestId('change-password-submit').click();
    await page.waitForTimeout(500);
    await ctx.close();
  });

  test('member is redirected away from /admin', async ({ page }) => {
    await loginAs(page, memberEmail, MEMBER_PASSWORD);
    await page.goto('/admin/users');
    await expect(page).not.toHaveURL(/\/admin\/users/);
  });

  test('member cannot create a user via direct API call', async ({ page }) => {
    await loginAs(page, memberEmail, MEMBER_PASSWORD);
    const csrf = await page.evaluate(
      () => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '',
    );
    const res = await page.request.post('/api/admin/users', {
      headers: { 'x-csrf-token': csrf },
      data: { email: 'escalation@example.com', displayName: 'Nope', role: 'admin' },
    });
    expect(res.status()).toBe(403);
  });

  test('member cannot read the audit log', async ({ page }) => {
    await loginAs(page, memberEmail, MEMBER_PASSWORD);
    const res = await page.request.get('/api/admin/audit');
    expect(res.status()).toBe(403);
  });

  test('client-supplied role in login payload is ignored', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: memberEmail, password: MEMBER_PASSWORD, role: 'admin' },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.data.role).toBe('member');
    }
  });
});

test.describe('Admin lifecycle', () => {
  test('deactivated user cannot sign in', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const admin = new AdminPage(page);
    await admin.gotoUsers();
    const email = `deactivate-${Date.now()}@example.com`;
    const setupUrl = await admin.createUser(email, 'To Be Deactivated');

    const pw = 'temp-password-for-tests-9';
    await page.goto(new URL(setupUrl).pathname + new URL(setupUrl).search);
    await page.getByTestId('new-password-input').fill(pw);
    await page.getByTestId('confirm-password-input').fill(pw);
    await page.getByTestId('change-password-submit').click();
    await page.waitForTimeout(500);
    await ctx.close();

    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await loginAs(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin2 = new AdminPage(adminPage);
    await admin2.gotoUsers();
    await admin2.deactivate(email);
    await adminPage.waitForTimeout(800);
    // Assert the precondition. A silently-failed deactivation would otherwise
    // read as a broken security control.
    await admin2.expectStatus(email, 'Inactive');
    await adminCtx.close();

    const userCtx = await browser.newContext();
    const userPage = await userCtx.newPage();
    const login = new LoginPage(userPage);
    await login.goto();
    await login.loginRaw(email, pw);
    await login.expectGenericError();
    await userCtx.close();
  });

  test('last active admin cannot be deactivated', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await page.request.get('/api/admin/users');
    const { data } = await res.json();
    const admins = data.users.filter((u: { role: string; isActive: boolean }) => u.role === 'admin' && u.isActive);

    if (admins.length === 1) {
      const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
      const patch = await page.request.patch(`/api/admin/users/${admins[0].id}`, {
        headers: { 'x-csrf-token': csrf },
        data: { action: 'deactivate' },
      });
      expect(patch.status()).toBe(409);
      expect((await patch.json()).error.code).toBe('LAST_ADMIN');
    }
  });

  test('every admin action is audited', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = new AdminPage(page);
    await admin.gotoUsers();
    await admin.createUser(`audited-${Date.now()}@example.com`, 'Audited User');
    await admin.expectAuditContains('ADMIN.USER_CREATED');
    await admin.expectAuditContains('AUTH.LOGIN_SUCCESS');
  });
});
