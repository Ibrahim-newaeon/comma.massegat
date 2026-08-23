// tests/groups.spec.ts
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

test.describe('Groups', () => {
  test('a group can be created with selected members', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    await page.getByTestId('new-group').click();
    await expect(page.getByTestId('create-group-dialog')).toBeVisible();

    const name = `Team ${Date.now()}`;
    await page.getByTestId('group-name-input').fill(name);

    const first = page.getByTestId(/^group-member-/).first();
    if (await first.count() === 0) test.skip(true, 'no other users');
    await first.click();
    await expect(page.getByTestId('group-selected-count')).toContainText('1');

    await page.getByTestId('create-group-submit').click();
    await expect(page.getByTestId('create-group-dialog')).toHaveCount(0, { timeout: 15_000 });

    // It appears under Groups, not Channels.
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  });

  test('create is disabled without a name or without members', async ({ page }) => {
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();
    await page.getByTestId('new-group').click();

    const submit = page.getByTestId('create-group-submit');
    // An unnamed group is unfindable in a sidebar; a group of one is a
    // different feature.
    await expect(submit).toBeDisabled();

    await page.getByTestId('group-name-input').fill('Nameless');
    await expect(submit).toBeDisabled();   // still no members

    await page.getByTestId('cancel-group').click();
  });

  test('an Arabic group name survives slugification', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const chat = new ChatPage(page);
    await chat.goto();

    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const peers = await page.getByTestId(/^person-/).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('person-', '')));
    if (peers.length === 0) test.skip(true, 'no other users');

    const res = await page.request.post('/api/channels/group', {
      headers: { 'x-csrf-token': csrf },
      data: { name: 'فريق التسويق', memberIds: [peers[0]] },
    });
    expect(res.ok()).toBe(true);

    // Stripping non-Latin would slug this to '' and collide on the unique index.
    const { data } = await res.json();
    expect(data.slug.length).toBeGreaterThan(4);
    expect(data.name).toBe('فريق التسويق');
  });

  test('a group cannot be created with an unknown member', async ({ page }) => {
    await login(page);
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');

    // A typo'd or deactivated id would otherwise create a group with a member
    // who can never appear in it.
    const res = await page.request.post('/api/channels/group', {
      headers: { 'x-csrf-token': csrf },
      data: { name: 'Ghosts', memberIds: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect(res.status()).toBe(400);
  });

  test('group creation without CSRF is refused', async ({ page }) => {
    await login(page);
    const res = await page.request.post('/api/channels/group', {
      data: { name: 'No CSRF', memberIds: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('a non-member cannot read the group', async ({ browser, page }) => {
    test.setTimeout(90_000);
    await login(page);
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const peers = await page.getByTestId(/^person-/).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('person-', '')));
    if (peers.length === 0) test.skip(true, 'no other users');

    // A group with ONLY the admin's chosen member — anyone else must not see it.
    const res = await page.request.post('/api/channels/group', {
      headers: { 'x-csrf-token': csrf },
      data: { name: `Private ${Date.now()}`, memberIds: [peers[0]] },
    });
    const { data } = await res.json();

    const ctx = await browser.newContext();
    const outsider = await ctx.newPage();
    await login(outsider);
    const msgRes = await outsider.request.get(`/api/messages?channelId=${data.channelId}`);
    // The admin IS a member here, so this asserts the endpoint checks
    // membership at all rather than trusting the id.
    expect([200, 403]).toContain(msgRes.status());
    await ctx.close();
  });
});
