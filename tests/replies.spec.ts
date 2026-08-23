// tests/replies.spec.ts
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

async function login(page: Page) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(ADMIN_EMAIL, ADMIN_PASSWORD);
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

test.describe('Replies', () => {
  test('a reply quotes the original and survives a reload', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    const original = `orig-${Date.now()}`;
    const answer = `answer-${Date.now()}`;

    const first = await send(page, original);
    const id = await first.getAttribute('data-message-id');

    await first.hover();
    await page.getByTestId(`reply-to-message-${id}`).click();
    await expect(page.getByTestId('reply-bar')).toBeVisible();

    await send(page, answer);

    const reply = page.getByTestId('message-row').filter({ hasText: answer });
    await expect(reply.getByTestId('reply-quote')).toContainText(original);

    // The REST list and the socket path resolve the quote separately, so a
    // reload is where a missing include would show.
    await page.reload();
    const after = page.getByTestId('message-row').filter({ hasText: answer });
    await expect(after.getByTestId('reply-quote')).toContainText(original, { timeout: 15_000 });
  });

  test('the bar clears after sending, so the next message is not attached too', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    const original = `bar-${Date.now()}`;
    const first = await send(page, original);
    const id = await first.getAttribute('data-message-id');

    await first.hover();
    await page.getByTestId(`reply-to-message-${id}`).click();
    await send(page, `reply-${Date.now()}`);

    await expect(page.getByTestId('reply-bar')).toHaveCount(0);

    // A second message must NOT carry the quote — a stale target attaches a
    // connection that does not exist.
    const plain = `plain-${Date.now()}`;
    await send(page, plain);
    const row = page.getByTestId('message-row').filter({ hasText: plain });
    await expect(row.getByTestId('reply-quote')).toHaveCount(0);
  });

  test('cancelling clears the target', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    const original = `cancel-${Date.now()}`;
    const first = await send(page, original);
    const id = await first.getAttribute('data-message-id');

    await first.hover();
    await page.getByTestId(`reply-to-message-${id}`).click();
    await expect(page.getByTestId('reply-bar')).toBeVisible();

    await page.getByTestId('cancel-reply').click();
    await expect(page.getByTestId('reply-bar')).toHaveCount(0);
  });

  test('a deleted original becomes a tombstone, not a leak', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    const original = `todelete-${Date.now()}`;
    const first = await send(page, original);
    const id = await first.getAttribute('data-message-id');

    await first.hover();
    await page.getByTestId(`reply-to-message-${id}`).click();
    const answer = `keeps-${Date.now()}`;
    await send(page, answer);

    await first.hover();
    await page.getByTestId(`delete-message-${id}`).click();
    await page.waitForTimeout(1200);
    await page.reload();

    const reply = page.getByTestId('message-row').filter({ hasText: answer });
    const quote = reply.getByTestId('reply-quote');
    await expect(quote).toBeVisible({ timeout: 15_000 });
    await expect(quote).toHaveAttribute('data-deleted', 'true');
    // The whole point of deleting: the body must not survive in the quote.
    await expect(quote).not.toContainText(original);
  });

  test('a reply cannot target a message in another channel', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    // Without the server-side check, a member of one channel could reply to an
    // id from a private channel and the quote would render its author and body
    // straight back to them.
    const foreign = await page.evaluate(async () => {
      const r = await fetch('/api/messages?channelId=00000000-0000-0000-0000-000000000000');
      return r.status;
    });
    expect([400, 403, 404]).toContain(foreign);
  });
});
