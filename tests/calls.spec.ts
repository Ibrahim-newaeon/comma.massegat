// tests/calls.spec.ts
//
// Playwright runs Chromium with fake media devices (see playwright.config.ts),
// so camera and microphone permission prompts never appear and a synthetic
// video stream is published. That is enough to prove the full path: token →
// SFU connect → tracks published → participants visible.
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { ChatPage } from './pages/ChatPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';
const PEER_PASSWORD = 'call-peer-password-1';

async function login(page: Page, email: string, password: string) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(email, password);
  await page.waitForTimeout(600);
}

async function openChat(page: Page) {
  const chat = new ChatPage(page);
  await chat.goto();
  await chat.selectChannel('general');
  return chat;
}

test.describe('Calls — single participant', () => {
  test('starting a call connects and shows the local tile', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);

    await page.getByTestId('start-call').click();

    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('participant-tile')).toHaveCount(1, { timeout: 30_000 });
  });

  test('mute and camera toggles change state', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    const audio = page.getByTestId('toggle-audio');
    await expect(audio).toHaveAttribute('data-enabled', 'true');
    await audio.click();
    await expect(audio).toHaveAttribute('data-enabled', 'false');

    const video = page.getByTestId('toggle-video');
    await video.click();
    await expect(video).toHaveAttribute('data-enabled', 'false');
    // With the camera off the tile shows initials rather than a black rectangle.
    await expect(page.getByTestId('camera-off-placeholder')).toBeVisible({ timeout: 10_000 });
  });

  test('leaving the call tears down the view', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    await page.getByTestId('leave-call').click();
    await expect(page.getByTestId('call-view')).toHaveCount(0, { timeout: 15_000 });
  });

  test('call controls are NOT mirrored in RTL', async ({ page, context }) => {
    test.setTimeout(90_000);
    // Media controls are spatial, not directional — mirroring them breaks the
    // mental model. MEGA-PROMPT §6.5.
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    const dir = await page.getByTestId('leave-call').evaluate(
      (n) => getComputedStyle(n.parentElement!).direction,
    );
    expect(dir).toBe('ltr');
  });

  test('control buttons meet the 56px touch target', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    for (const id of ['toggle-audio', 'toggle-video', 'leave-call']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(56);
      expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(56);
    }
  });
});

test.describe('Calls — two parties', () => {
  test('both participants see each other', async ({ browser }) => {
    test.setTimeout(150_000);

    // Provision a second real user.
    const setupCtx = await browser.newContext();
    const setupPage = await setupCtx.newPage();
    await login(setupPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = new AdminPage(setupPage);
    await admin.gotoUsers();
    const peerEmail = `call-peer-${Date.now()}@example.com`;
    const setupUrl = await admin.createUser(peerEmail, 'Call Peer', 'member');
    const u = new URL(setupUrl);
    await setupPage.goto(u.pathname + u.search);
    await setupPage.getByTestId('new-password-input').fill(PEER_PASSWORD);
    await setupPage.getByTestId('confirm-password-input').fill(PEER_PASSWORD);
    await setupPage.getByTestId('change-password-submit').click();
    await setupPage.waitForTimeout(800);
    await setupCtx.close();

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await login(a, ADMIN_EMAIL, ADMIN_PASSWORD);
    await login(b, peerEmail, PEER_PASSWORD);
    await openChat(a);
    await openChat(b);

    await a.getByTestId('start-call').click();
    await expect(a.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    await b.getByTestId('start-call').click();
    await expect(b.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    // Each side sees itself plus the other.
    await expect(a.getByTestId('participant-tile')).toHaveCount(2, { timeout: 45_000 });
    await expect(b.getByTestId('participant-tile')).toHaveCount(2, { timeout: 45_000 });

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('Calls — authorization', () => {
  test('token is refused for a channel the user is not in', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const res = await page.request.post('/api/calls/token', {
      headers: { 'x-csrf-token': csrf },
      data: { channelId: '00000000-0000-0000-0000-000000000000' },
    });
    expect([403, 404, 400]).toContain(res.status());
  });

  test('unauthenticated token request is refused', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/login');
    const res = await p.request.post('/api/calls/token', {
      data: { channelId: '00000000-0000-0000-0000-000000000000' },
    });
    expect([401, 403]).toContain(res.status());
    await ctx.close();
  });

  test('token request without a CSRF header is refused', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await page.request.post('/api/calls/token', {
      data: { channelId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('an unsigned SFU webhook is rejected', async ({ request }) => {
    // Without this check anyone could forge call records — including claiming
    // someone attended a call they were never on.
    const res = await request.post('/api/calls/webhook', {
      data: { event: 'room_finished', room: { name: 'call-forged' } },
    });
    expect(res.status()).toBe(401);
  });

  test('the granted token does not carry roomAdmin', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);

    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const channelId = await page.evaluate(async () => {
      const r = await fetch('/api/channels');
      const j = await r.json();
      return j.data.channels.find((c: { slug: string }) => c.slug === 'general')?.id;
    });

    const res = await page.request.post('/api/calls/token', {
      headers: { 'x-csrf-token': csrf },
      data: { channelId },
    });
    expect(res.ok()).toBe(true);

    const { token } = (await res.json()).data;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    expect(payload.video.roomJoin).toBe(true);
    // Either would let an end user evict others or open arbitrary rooms.
    expect(payload.video.roomAdmin).toBeFalsy();
    expect(payload.video.roomCreate).toBeFalsy();
    // The room is derived from the channel, never client-supplied.
    expect(payload.video.room).toBe(`call-${channelId}`);
  });
});

test.describe('Calls — system message', () => {
  test('a completed call posts a notice into the channel', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = await openChat(page);

    const before = await page.getByTestId('system-notice').count();

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    // A call under 15s with one participant is suppressed as noise, so stay in.
    await page.waitForTimeout(20_000);
    await page.getByTestId('leave-call').click();
    await expect(page.getByTestId('call-view')).toHaveCount(0, { timeout: 15_000 });

    const notice = page.getByTestId('system-notice').last();
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveAttribute('data-system-type', 'call_ended');
    expect(await page.getByTestId('system-notice').count()).toBeGreaterThan(before);
    void chat;
  });

  test('a system notice cannot be deleted', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);

    const notice = page.getByTestId('system-notice');
    if (await notice.count() === 0) test.skip(true, 'no system notice present yet');

    // It is not a bubble, so it carries no delete control at all.
    const row = page.getByTestId('message-row').filter({ hasText: 'Call ended' });
    expect(await row.count()).toBe(0);
  });
});

test.describe('Calls — timer', () => {
  test('the timer counts up while in a call', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    const timer = page.getByTestId('call-timer');
    await expect(timer).toBeVisible();

    const first = Number(await timer.getAttribute('data-elapsed-seconds'));
    await page.waitForTimeout(4000);
    const second = Number(await timer.getAttribute('data-elapsed-seconds'));

    expect(second).toBeGreaterThan(first);
    // Anchored to a timestamp, so ~4s of wall clock is ~4s of elapsed.
    expect(second - first).toBeGreaterThanOrEqual(3);
    expect(second - first).toBeLessThanOrEqual(6);

    await expect(timer).toHaveText(/^\d+:\d{2}$/);
  });

  test('the timer renders LTR even in an Arabic UI', async ({ page, context }) => {
    test.setTimeout(90_000);
    // A duration is not directional text — 12:05 must not read as 05:12.
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    const dir = await page.getByTestId('call-timer').evaluate((n) => getComputedStyle(n).direction);
    expect(dir).toBe('ltr');
  });
});

test.describe('Calls — layout', () => {
  test('the call sits BESIDE the chat on desktop', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    const call = await page.getByTestId('call-container').boundingBox();
    const chat = await page.getByTestId('chat-column').boundingBox();

    // Side by side: the chat column starts to the right of where the call ends.
    // Stacked, they would share an x and differ only in y.
    expect(chat!.x).toBeGreaterThan(call!.x + call!.width - 20);
  });

  test('it stacks on a phone, where there is no width to split', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    const call = await page.getByTestId('call-container').boundingBox();
    const chat = await page.getByTestId('chat-column').boundingBox();

    expect(Math.abs(chat!.x - call!.x)).toBeLessThan(20);
    expect(chat!.y).toBeGreaterThan(call!.y);
  });

  test('the composer stays reachable during a call', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    // The whole point of the split: you can still type. Stacked, the composer
    // was pushed below the fold.
    const composer = page.getByTestId('composer-input');
    await expect(composer).toBeInViewport();
    await composer.fill('typing during a call');
    await expect(composer).toHaveValue('typing during a call');
  });

  test('the pop-out control is hidden where the API is unavailable', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openChat(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByTestId('start-call').click();
    await expect(page.getByTestId('call-view')).toBeVisible({ timeout: 45_000 });

    // Chromium supports it; other engines must not show a dead button.
    const supported = await page.evaluate(() => 'documentPictureInPicture' in window);
    await expect(page.getByTestId('pop-out-call')).toHaveCount(supported ? 1 : 0);
  });
});
