// tests/chat-rtl.spec.ts
// The RTL suite. These are quality bugs, not scale bugs — they only surface
// when someone actually reads a mixed-script conversation.
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

async function setLocale(page: import('@playwright/test').Page, locale: 'en' | 'ar') {
  await page.context().addCookies([
    { name: 'cp_locale', value: locale, url: 'http://localhost:3000' },
  ]);
}

async function login(page: import('@playwright/test').Page) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForTimeout(600);
}

test.describe('RTL — content direction is per message, never inherited', () => {
  test('English message inside an Arabic UI renders LTR', async ({ page }) => {
    await setLocale(page, 'ar');
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    // UI is RTL...
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const text = `English message ${Date.now()}`;
    await chat.send(text);
    await chat.expectMessage(text);

    // ...but this message's text runs LTR.
    await chat.expectMessageDirection(text, 'ltr');
  });

  test('Arabic message inside an English UI renders RTL', async ({ page }) => {
    await setLocale(page, 'en');
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    const text = `رسالة عربية ${Date.now()}`;
    await chat.send(text);
    await chat.expectMessage('رسالة عربية');
    await chat.expectMessageDirection('رسالة عربية', 'rtl');
  });

  test('mixed AR+EN message survives without character reordering', async ({ page }) => {
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    const stamp = Date.now();
    const text = `مرحبا Ahmad، the meeting is at 3pm ${stamp}`;
    await chat.send(text);
    await chat.expectMessage('Ahmad');

    // textContent preserves logical order regardless of visual direction.
    const rendered = await chat.messages().filter({ hasText: String(stamp) }).first().textContent();
    expect(rendered).toBe(text);
  });

  test('URL inside an Arabic message is isolated to LTR', async ({ page }) => {
    await setLocale(page, 'ar');
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    const stamp = Date.now();
    await chat.send(`الرابط هنا https://example.com/path?q=${stamp}`);
    await chat.expectMessage('example.com');

    const seg = page.getByTestId('ltr-segment').filter({ hasText: 'example.com' }).first();
    await expect(seg).toBeVisible();
    const dir = await seg.evaluate((n) => getComputedStyle(n).direction);
    expect(dir).toBe('ltr');
  });
});

test.describe('RTL — layout and typography', () => {
  test('channel list mirrors to the correct side', async ({ page }) => {
    await setLocale(page, 'ar');
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    const nav = page.getByTestId('channel-list');
    const navBox = await nav.boundingBox();
    const paneBox = await page.getByTestId('chat-pane').boundingBox();

    // In RTL the sidebar sits to the right of the message pane.
    expect(navBox!.x).toBeGreaterThan(paneBox!.x);
  });

  test('no letter-spacing on Arabic text', async ({ page }) => {
    await setLocale(page, 'ar');
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.send('نص عربي للاختبار');
    await chat.expectMessage('نص عربي');

    // letter-spacing breaks Arabic cursive joining.
    const spacing = await chat.messages().first().evaluate(
      (n) => getComputedStyle(n).letterSpacing,
    );
    expect(['normal', '0px']).toContain(spacing);
  });

  test('composer direction flips on the first strong character', async ({ page }) => {
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.composer().fill('hello');
    expect(await chat.composer().evaluate((n) => getComputedStyle(n).direction)).toBe('ltr');

    await chat.composer().fill('مرحبا');
    expect(await chat.composer().evaluate((n) => getComputedStyle(n).direction)).toBe('rtl');
  });

  test('Shift+Enter newlines and Enter sends — in RTL too', async ({ page }) => {
    await setLocale(page, 'ar');
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    await chat.composer().click();
    await page.keyboard.type('سطر أول');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('سطر ثاني');

    expect(await chat.composer().inputValue()).toContain('\n');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    expect(await chat.composer().inputValue()).toBe('');
  });

  test('composer meets the 56px touch target minimum', async ({ page }) => {
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();
    const box = await chat.sendButton().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(56);
  });
});
