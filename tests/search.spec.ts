// tests/search.spec.ts
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

async function login(page: Page) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForTimeout(600);
}

test.describe('Search', () => {
  test('finds a message just sent', async ({ page }) => {
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.selectChannel('general');

    const marker = `findme-${Date.now()}`;
    await chat.send(`the quarterly ${marker} report`);
    await page.waitForTimeout(1500);

    await page.getByTestId('open-search').click();
    await page.getByTestId('search-input').fill(marker);

    await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Arabic normalisation — مدرسه finds مَدْرَسَة', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.selectChannel('general');

    const stamp = Date.now();
    // Written WITH harakat and a taa marbuta.
    await chat.send(`مَدْرَسَة ${stamp}`);
    await page.waitForTimeout(1500);

    await page.getByTestId('open-search').click();
    // Searched WITHOUT harakat, with haa instead of taa marbuta — how people
    // actually type. This is the whole point of normalisation.
    await page.getByTestId('search-input').fill(`مدرسه ${stamp}`);

    await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 15_000 });
  });

  test('results are scoped to channels the user belongs to', async ({ page }) => {
    await login(page);
    const res = await page.request.get('/api/search?q=test');
    expect(res.ok()).toBe(true);

    const { data } = await res.json();
    const channelRes = await page.request.get('/api/channels');
    const mine = new Set(
      (await channelRes.json()).data.channels.map((c: { id: string }) => c.id),
    );

    // Membership is a JOIN condition, not a filter applied afterwards.
    for (const r of data.results) expect(mine.has(r.channelId)).toBe(true);
  });

  test('unauthenticated search is refused', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/login');
    const res = await p.request.get('/api/search?q=anything');
    expect([401, 403]).toContain(res.status());
    await ctx.close();
  });

  test('a SQL injection payload is treated as text', async ({ page }) => {
    await login(page);
    const res = await page.request.get(
      `/api/search?q=${encodeURIComponent("'; DROP TABLE messages; --")}`,
    );
    // Parameterised throughout, so this is just a search term that finds nothing.
    expect([200, 400]).toContain(res.status());

    const check = await page.request.get('/api/channels');
    expect(check.ok()).toBe(true);   // the table is still there
  });

  test('search input reads correctly in an Arabic UI', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    await page.getByTestId('open-search').click();
    const input = page.getByTestId('search-input');
    await input.fill('مرحبا');
    // dir="auto" flips on the first strong character.
    expect(await input.evaluate((n) => getComputedStyle(n).direction)).toBe('rtl');

    await input.fill('hello');
    expect(await input.evaluate((n) => getComputedStyle(n).direction)).toBe('ltr');
  });
});

test.describe('PWA', () => {
  test('the manifest is served', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.name).toBeTruthy();
    expect(m.start_url).toBe('/chat');
  });

  test('the service worker is served without a session', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    // Must load before login, or the app cannot be installed from that screen.
    const res = await p.request.get('/sw.js');
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain('addEventListener');
    await ctx.close();
  });

  test('CSP permits the service worker', async ({ request }) => {
    const res = await request.get('/login');
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("worker-src 'self'");
  });
});
