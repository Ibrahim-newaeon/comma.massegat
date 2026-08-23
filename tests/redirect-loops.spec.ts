// tests/redirect-loops.spec.ts
// Regression guard. An unenrolled admin previously hit an infinite redirect:
// /admin/totp lived inside the admin layout that redirects TO /admin/totp.
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

test.describe('No redirect loops', () => {
  test('/setup-2fa settles without looping', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForTimeout(500);

    let requests = 0;
    page.on('request', (r) => { if (r.url().includes('/setup-2fa')) requests++; });

    await page.goto('/setup-2fa');
    await page.waitForTimeout(3000);

    // A loop produced hundreds of requests. A healthy page makes a handful.
    expect(requests).toBeLessThan(10);
  });

  test('every authenticated route settles on a stable URL', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForTimeout(500);

    for (const path of ['/', '/setup-2fa', '/admin/users', '/admin/audit']) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      const first = page.url();
      await page.waitForTimeout(1500);
      expect(page.url()).toBe(first);   // URL must not still be moving
    }
  });

  test('dev CSP allows React hydration — interactive elements respond', async ({ page }) => {
    // Regression: strict script-src blocked hydration; buttons rendered dead.
    const violations: string[] = [];
    page.on('console', (m) => {
      if (m.text().includes('Content Security Policy')) violations.push(m.text());
    });

    const login = new LoginPage(page);
    await login.goto();
    await login.email().fill('probe@example.com');
    await login.password().fill('some-password-value');

    // If hydration failed, React state never updates and this stays disabled.
    await expect(login.submit()).toBeEnabled();
    expect(violations).toHaveLength(0);
  });
});
