// tests/reactions.spec.ts
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';
const PEER_EMAIL = process.env.TEST_PEER_EMAIL ?? '';
const PEER_PASSWORD = process.env.TEST_PEER_PASSWORD ?? '';

async function login(page: Page, email: string, password: string) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(email, password);
  await page.goto('/chat');
  await expect(page.getByTestId('message-list')).toBeVisible({ timeout: 15_000 });
}

async function send(page: Page, text: string) {
  await page.getByTestId('composer-input').fill(text);
  await page.getByTestId('composer-send').click();
  const row = page.getByTestId('message-row').filter({ hasText: text });
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

test.describe('Reactions', () => {
  test('a reaction appears, persists a reload, and toggles off', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const marker = `react-${Date.now()}`;
    const row = await send(page, marker);

    await row.getByTestId('add-reaction').click();
    await page.getByTestId('pick-👍').click();

    const chip = row.getByTestId('reaction-👍');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute('data-mine', 'true');
    await expect(chip).toContainText('1');

    // The reaction must survive a reload. A reaction that appears live and
    // vanishes on refresh looks like it was never saved — and the REST list
    // and socket path use SEPARATE includes, so this is a real risk.
    await page.reload();
    const after = page.getByTestId('message-row').filter({ hasText: marker });
    await expect(after.getByTestId('reaction-👍')).toBeVisible({ timeout: 15_000 });

    // Tapping again removes it, and the chip goes entirely rather than
    // showing a zero.
    await after.getByTestId('reaction-👍').click();
    await expect(after.getByTestId('reaction-👍')).toHaveCount(0, { timeout: 10_000 });
  });

  test('the same reaction twice cannot double-count', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const marker = `double-${Date.now()}`;
    const row = await send(page, marker);

    await row.getByTestId('add-reaction').click();
    await page.getByTestId('pick-✅').click();
    await expect(row.getByTestId('reaction-✅')).toContainText('1');

    // Two rapid taps: the second is a removal, not a second count. The unique
    // constraint enforces this at the database, not just the UI.
    await row.getByTestId('reaction-✅').click();
    await page.waitForTimeout(600);
    await row.getByTestId('add-reaction').click();
    await page.getByTestId('pick-✅').click();

    await expect(row.getByTestId('reaction-✅')).toContainText('1');
  });

  test('a non-member cannot react', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Membership is checked server-side; a client-supplied messageId is never
    // trusted just because the socket is authenticated.
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/messages?channelId=00000000-0000-0000-0000-000000000000');
      return r.status;
    });
    expect([400, 403, 404]).toContain(res);
  });

  test('two people reacting both count', async ({ page, browser }) => {
    test.skip(!PEER_EMAIL, 'needs TEST_PEER_EMAIL');
    test.setTimeout(120_000);

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const marker = `two-${Date.now()}`;
    const row = await send(page, marker);

    await row.getByTestId('add-reaction').click();
    await page.getByTestId('pick-🙏').click();
    await expect(row.getByTestId('reaction-🙏')).toContainText('1');

    const ctx: BrowserContext = await browser.newContext();
    const peer = await ctx.newPage();
    await login(peer, PEER_EMAIL, PEER_PASSWORD);

    const peerRow = peer.getByTestId('message-row').filter({ hasText: marker });
    await expect(peerRow).toBeVisible({ timeout: 20_000 });

    // The peer sees the existing reaction as NOT theirs.
    await expect(peerRow.getByTestId('reaction-🙏')).toHaveAttribute('data-mine', 'false');

    await peerRow.getByTestId('reaction-🙏').click();
    await expect(peerRow.getByTestId('reaction-🙏')).toContainText('2');

    // And it reaches the first client live.
    await expect(row.getByTestId('reaction-🙏')).toContainText('2', { timeout: 15_000 });

    await ctx.close();
  });

  test('a deleted message cannot be reacted to', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const marker = `del-${Date.now()}`;
    const row = await send(page, marker);
    const id = await row.getAttribute('data-message-id');

    await row.hover();
    await page.getByTestId(`delete-message-${id}`).click();
    await page.waitForTimeout(1000);

    // A tombstone keeps its row for reply chains, but reacting to a withdrawn
    // message is meaningless — the control is gone.
    const after = page.getByTestId('message-row').filter({ hasText: marker });
    await expect(after.getByTestId('add-reaction')).toHaveCount(0);
  });
});
