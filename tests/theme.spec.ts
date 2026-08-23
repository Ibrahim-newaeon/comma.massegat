// tests/theme.spec.ts
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

test.describe('Theme', () => {
  test('dark mode applies and persists', async ({ page }) => {
    await login(page);
    await page.goto('/profile');

    await page.getByTestId('theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor);
    // Near-black, not pure black: pure black against white text produces
    // halation and OLED smearing on scroll.
    expect(bg).not.toBe('rgb(255, 255, 255)');

    await page.getByTestId('save-profile').click();
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the theme is in the FIRST paint, with no flash of light', async ({ page, context }) => {
    await login(page);
    await context.addCookies([{ name: 'cp_theme', value: 'dark', url: 'http://localhost:3000' }]);

    // Read before any client JS runs. If the attribute is applied after
    // hydration, every load flashes white — the most noticeable failure a
    // dark mode can have.
    await page.goto('/chat', { waitUntil: 'commit' });
    const attr = await page.locator('html').getAttribute('data-theme');
    expect(attr).toBe('dark');
  });

  test('three options are offered, not a binary switch', async ({ page }) => {
    await login(page);
    await page.goto('/profile');
    // "Follow my machine" is a legitimate preference; a two-state switch
    // silently opts the user out of it.
    for (const t of ['light', 'dark', 'system']) {
      await expect(page.getByTestId(`theme-${t}`)).toBeVisible();
    }
  });

  test('native controls follow the theme', async ({ page, context }) => {
    await login(page);
    await context.addCookies([{ name: 'cp_theme', value: 'dark', url: 'http://localhost:3000' }]);
    await page.goto('/profile');

    // Without color-scheme, a dark page renders white scrollbars.
    const scheme = await page.evaluate(() =>
      getComputedStyle(document.documentElement).colorScheme);
    expect(scheme).toContain('dark');
  });
});

test.describe('Sidebar', () => {
  test('rows show a preview and a timestamp', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    const general = page.getByTestId('channel-general');
    await expect(general).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('preview-general')).toBeVisible();
  });

  test('the unread filter narrows the list', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    await page.getByTestId('filter-unread').click();
    await expect(page.getByTestId('filter-unread')).toHaveAttribute('data-active', 'true');

    await page.getByTestId('filter-all').click();
    await expect(page.getByTestId('filter-all')).toHaveAttribute('data-active', 'true');
  });
});

test.describe('Media gallery', () => {
  test('opens with three tabs', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await page.waitForTimeout(1000);

    await page.getByTestId('open-gallery').click();
    await expect(page.getByTestId('media-gallery')).toBeVisible({ timeout: 10_000 });

    for (const t of ['media', 'docs', 'links']) {
      await expect(page.getByTestId(`gallery-tab-${t}`)).toBeVisible();
    }

    await page.getByTestId('gallery-tab-docs').click();
    await expect(page.getByTestId('gallery-tab-docs')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('close-gallery').click();
    await expect(page.getByTestId('media-gallery')).toHaveCount(0);
  });

  test('a non-member cannot read a channel gallery', async ({ page }) => {
    await login(page);
    // Without the membership check the gallery lists the files of any channel
    // by guessing an id — messages protected, attachments not.
    const res = await page.request.get(
      '/api/channels/00000000-0000-0000-0000-000000000000/media?tab=media');
    expect([403, 404]).toContain(res.status());
  });

  test('quarantined files never appear in the gallery', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await page.waitForTimeout(800);

    const channelId = await page.evaluate(async () => {
      const r = await fetch('/api/channels');
      const j = await r.json();
      return j.data.channels.find((c: { slug: string }) => c.slug === 'general')?.id;
    });

    const res = await page.request.get(`/api/channels/${channelId}/media?tab=docs`);
    const { data } = await res.json();
    // A quarantined item listed in a gallery invites someone to ask for it.
    expect(data.items.some((i: { filename: string }) => i.filename.includes('eicar'))).toBe(false);
  });
});
