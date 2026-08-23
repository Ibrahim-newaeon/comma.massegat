// tests/rtl.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test.describe('RTL / bidirectional', () => {
  test('UI direction follows the locale cookie', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    await context.clearCookies();
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('email field stays LTR even in an RTL UI', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    const login = new LoginPage(page);
    await login.goto();

    const direction = await login.email().evaluate((el) => getComputedStyle(el).direction);
    expect(direction).toBe('ltr');
  });

  test('Arabic UI renders Arabic strings', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await page.goto('/login');
    await expect(page.getByTestId('app-name')).toHaveText('منصة التواصل');
  });

  test('no Arabic text has letter-spacing applied', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await page.goto('/login');

    // letter-spacing breaks Arabic cursive joining.
    const spacing = await page.getByTestId('app-name').evaluate(
      (el) => getComputedStyle(el).letterSpacing,
    );
    expect(['normal', '0px']).toContain(spacing);
  });

  test('touch targets meet the 56px minimum', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    const box = await login.submit().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  });

  test('login form is fully keyboard navigable', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.email().focus();
    await page.keyboard.type('keyboard@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('some-password-here');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(focused).toBe('password-input');
  });
});
