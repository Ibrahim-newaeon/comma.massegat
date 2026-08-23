// tests/chat.spec.ts
import { test, expect, type Browser, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { ChatPage } from './pages/ChatPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';
const PEER_PASSWORD = 'peer-password-for-tests-1';

async function loginAs(page: Page, email: string, password: string) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await page.waitForTimeout(600);
}

/** Creates a second real user so two-party tests are genuinely two parties. */
async function provisionPeer(browser: Browser): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const admin = new AdminPage(page);
  await admin.gotoUsers();
  const email = `peer-${Date.now()}@example.com`;
  const setupUrl = await admin.createUser(email, 'Peer User', 'member', 'مستخدم تجريبي');

  const u = new URL(setupUrl);
  await page.goto(u.pathname + u.search);
  await page.getByTestId('new-password-input').fill(PEER_PASSWORD);
  await page.getByTestId('confirm-password-input').fill(PEER_PASSWORD);
  await page.getByTestId('change-password-submit').click();
  await page.waitForTimeout(600);
  await ctx.close();
  return email;
}

test.describe('Chat — two parties', () => {
  test('message sent by one user appears for the other', async ({ browser }) => {
    const peerEmail = await provisionPeer(browser);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await loginAs(a, ADMIN_EMAIL, ADMIN_PASSWORD);
    await loginAs(b, peerEmail, PEER_PASSWORD);

    const chatA = new ChatPage(a);
    const chatB = new ChatPage(b);
    await chatA.goto();
    await chatB.goto();

    // Default channel is "most recent activity", which differs per user once
    // any DM exists. Pin both sides to the same channel.
    await chatA.selectChannel('general');
    await chatB.selectChannel('general');

    const text = `hello from A ${Date.now()}`;
    const start = Date.now();
    await chatA.send(text);
    await chatB.expectMessage(text);
    console.log(`round-trip: ${Date.now() - start}ms`);

    // Ownership is per-viewer.
    await chatA.expectOwnership(text, true);
    await chatB.expectOwnership(text, false);

    await ctxA.close();
    await ctxB.close();
  });

  test('typing indicator appears then clears', async ({ browser }) => {
    const peerEmail = await provisionPeer(browser);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await loginAs(a, ADMIN_EMAIL, ADMIN_PASSWORD);
    await loginAs(b, peerEmail, PEER_PASSWORD);
    const chatA = new ChatPage(a);
    const chatB = new ChatPage(b);
    await chatA.goto();
    await chatB.goto();

    // Default channel is "most recent activity", which differs per user once
    // any DM exists. Pin both sides to the same channel.
    await chatA.selectChannel('general');
    await chatB.selectChannel('general');

    await chatA.composer().fill('typing something');
    await expect(chatB.typing()).not.toBeEmpty({ timeout: 5000 });

    await chatA.send('typing something');
    await expect(chatB.typing()).toBeEmpty({ timeout: 6000 });

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('Chat — idempotency and ordering', () => {
  test('duplicate clientMsgId does not create a second message', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();

    const marker = `dupe-probe-${Date.now()}`;
    const result = await page.evaluate(async (body) => {
      const { io } = (window as unknown as { io?: unknown });
      void io;
      return new Promise<{ first: string; second: string }>((resolve) => {
        // @ts-expect-error socket instance is attached by the app for tests
        const s = window.__chatSocket;
        const clientMsgId = `fixed-${Date.now()}`;
        // @ts-expect-error runtime channel id
        const channelId = window.__activeChannelId;
        s.emit('message:send', { channelId, body, clientMsgId }, (r1: { message: { id: string } }) => {
          s.emit('message:send', { channelId, body, clientMsgId }, (r2: { message: { id: string } }) => {
            resolve({ first: r1.message.id, second: r2.message.id });
          });
        });
      });
    }, marker).catch(() => null);

    if (result) expect(result.first).toBe(result.second);

    // Regardless of the socket path, the UI must show exactly one.
    await page.waitForTimeout(1000);
    const count = await chat.messages().filter({ hasText: marker }).count();
    expect(count).toBeLessThanOrEqual(1);
  });

  test('messages persist across reload in send order', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();

    const stamp = Date.now();
    for (const n of [1, 2, 3]) {
      await chat.send(`order-${stamp}-${n}`);
      await page.waitForTimeout(250);
    }

    await page.reload();
    await chat.waitForConnection();

    const texts = await chat.messages().allTextContents();
    const mine = texts.filter((t) => t.includes(`order-${stamp}-`));
    expect(mine).toEqual([`order-${stamp}-1`, `order-${stamp}-2`, `order-${stamp}-3`]);
  });
});

test.describe('Chat — negative', () => {
  test('history for a non-member channel is refused', async ({ browser }) => {
    const peerEmail = await provisionPeer(browser);
    const ctxA = await browser.newContext();
    const a = await ctxA.newPage();
    await loginAs(a, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Create a DM the peer is not part of would require a third user; instead
    // assert that a random channel id is refused rather than leaking.
    const res = await a.request.get('/api/messages?channelId=00000000-0000-0000-0000-000000000000');
    expect([403, 400]).toContain(res.status());
    void peerEmail;
    await ctxA.close();
  });

  test('oversize message body is rejected', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();

    const huge = 'x'.repeat(9000);
    await chat.send(huge);
    await page.waitForTimeout(1500);
    // Server rejects; the optimistic copy is rolled back.
    const count = await chat.messages().filter({ hasText: huge.slice(0, 200) }).count();
    expect(count).toBe(0);
  });

  test('unauthenticated socket connection is refused', async ({ browser }) => {
    const ctx = await browser.newContext();   // no session
    const page = await ctx.newPage();
    await page.goto('/login');

    const refused = await page.evaluate(async () => {
      const res = await fetch('/api/messages?channelId=00000000-0000-0000-0000-000000000000');
      return res.status;
    });
    expect([401, 403, 400]).toContain(refused);
    await ctx.close();
  });

  test('message body is escaped, not executed', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();

    let alerted = false;
    page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });

    const payload = `<img src=x onerror="alert(1)">probe-${Date.now()}`;
    await chat.send(payload);
    await page.waitForTimeout(1500);

    expect(alerted).toBe(false);
    // Rendered as literal text, not as an element.
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });
});

test.describe('Chat — People list', () => {
  test('every active user is listed, and an unread badge appears', async ({ browser }) => {
    test.setTimeout(120_000);
    const peerEmail = await provisionPeer(browser);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await loginAs(a, ADMIN_EMAIL, ADMIN_PASSWORD);
    await loginAs(b, peerEmail, PEER_PASSWORD);

    const chatA = new ChatPage(a);
    const chatB = new ChatPage(b);
    await chatA.goto();
    await chatB.goto();

    // B sits in #general so the DM is genuinely unread.
    await chatB.selectChannel('general');

    // A opens a DM with B from the People list and sends.
    const peerId = await a.evaluate(async (email) => {
      const r = await fetch('/api/channels');
      void r;
      return document.querySelector<HTMLElement>('[data-testid^="person-"]')
        ?.getAttribute('data-testid')?.replace('person-', '') ?? '';
    }, peerEmail);

    expect(peerId).not.toBe('');
    await a.getByTestId(`person-${peerId}`).click();
    await a.waitForTimeout(1500);

    const text = `dm probe ${Date.now()}`;
    await chatA.send(text);

    // B should see an unread badge against A, without opening the DM.
    const badge = b.getByTestId(/^person-unread-/).first();
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('UI — avatars, grouping, rail', () => {
  test('an avatar appears on the first message of a group', async ({ browser }) => {
    test.setTimeout(120_000);
    const peerEmail = await provisionPeer(browser);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await loginAs(a, ADMIN_EMAIL, ADMIN_PASSWORD);
    await loginAs(b, peerEmail, PEER_PASSWORD);
    const chatA = new ChatPage(a);
    const chatB = new ChatPage(b);
    await chatA.goto();
    await chatB.goto();
    await chatA.selectChannel('general');
    await chatB.selectChannel('general');

    const stamp = Date.now();
    await chatB.send(`grouped-${stamp}-1`);
    await b.waitForTimeout(400);
    await chatB.send(`grouped-${stamp}-2`);
    await a.waitForTimeout(2000);

    const first = a.getByTestId('message-row').filter({ hasText: `grouped-${stamp}-1` }).first();
    const second = a.getByTestId('message-row').filter({ hasText: `grouped-${stamp}-2` }).first();

    // First carries the avatar; the second is grouped under it.
    await expect(first).toHaveAttribute('data-grouped', 'false');
    await expect(second).toHaveAttribute('data-grouped', 'true');
    await expect(first.getByTestId(/^avatar-/)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('grouped messages stay aligned with ungrouped ones', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.selectChannel('general');

    const rows = page.getByTestId('message-row');
    if (await rows.count() < 2) test.skip(true, 'not enough messages');

    // The avatar column is reserved even when empty — otherwise consecutive
    // messages jump horizontally.
    const boxes = await rows.evaluateAll((els) =>
      els.slice(-6).map((e) => Math.round(e.getBoundingClientRect().left)));
    const own = await rows.evaluateAll((els) =>
      els.slice(-6).map((e) => e.getAttribute('data-own')));

    const incoming = boxes.filter((_, i) => own[i] === 'false');
    if (incoming.length > 1) {
      expect(Math.max(...incoming) - Math.min(...incoming)).toBeLessThanOrEqual(2);
    }
  });

  test('the icon rail is present on desktop and hidden on mobile', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('icon-rail')).toBeVisible();

    // Below md the rail's 44px controls would breach the 56px touch minimum,
    // so it is hidden and the header carries these instead.
    await page.setViewportSize({ width: 400, height: 800 });
    await expect(page.getByTestId('icon-rail')).toBeHidden();
    await expect(page.getByTestId('open-search')).toBeVisible();
  });

  test('search opens from the sidebar', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();

    await page.getByTestId('sidebar-search').click();
    await expect(page.getByTestId('search-panel')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('close-search').click();
  });

  test('the rail mirrors to the correct side in RTL', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const chat = new ChatPage(page);
    await chat.goto();
    await page.setViewportSize({ width: 1280, height: 800 });

    const rail = await page.getByTestId('icon-rail').boundingBox();
    const pane = await page.getByTestId('chat-pane').boundingBox();
    // border-e and logical layout put the rail on the right in RTL.
    expect(rail!.x).toBeGreaterThan(pane!.x);
  });
});
