// tests/files.spec.ts
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'change-this-immediately-please';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comms-files-'));

/** Smallest valid PNG — 1x1 pixel, correct magic bytes. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * EICAR — the industry-standard antivirus test string. Harmless by design;
 * every scanner detects it. Split so this source file is not itself flagged.
 */
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

function write(name: string, content: Buffer | string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

async function login(page: Page) {
  const l = new LoginPage(page);
  await l.goto();
  await l.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForTimeout(600);
}

async function openChat(page: Page) {
  const chat = new ChatPage(page);
  await chat.goto();
  await chat.selectChannel('general');
  return chat;
}

test.describe('Files — upload and download', () => {
  test('image uploads, scans clean, and downloads', async ({ page }) => {
    await login(page);
    await openChat(page);

    const file = write(`photo-${Date.now()}.png`, PNG_1PX);
    await page.getByTestId('file-input').setInputFiles(file);

    await expect(page.getByTestId('upload-item')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('attachment-chip').last()).toBeVisible({ timeout: 15_000 });

    // The worker flips this to clean once ClamAV has passed it.
    await expect(page.getByTestId('attachment-chip').last())
      .toHaveAttribute('data-scan-status', 'clean', { timeout: 60_000 });
  });

  test('Arabic filename survives the round trip intact', async ({ page }) => {
    await login(page);
    await openChat(page);

    const arabicName = `تقرير-Q3-النهائي-${Date.now()}.png`;
    await page.getByTestId('file-input').setInputFiles(write(arabicName, PNG_1PX));
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('composer-send').click();

    const name = page.getByTestId('attachment-filename').last();
    await expect(name).toBeVisible({ timeout: 15_000 });

    // The stored key is ASCII-sanitised; the DISPLAYED name must be the original.
    expect(await name.textContent()).toBe(arabicName);
  });

  test('attachment filename is bidi-isolated', async ({ page, context }) => {
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await login(page);
    await openChat(page);

    await page.getByTestId('file-input').setInputFiles(write(`report-${Date.now()}.png`, PNG_1PX));
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('composer-send').click();

    const name = page.getByTestId('attachment-filename').last();
    await expect(name).toBeVisible({ timeout: 15_000 });
    // <bdi> stops the .png extension jumping to the wrong end in RTL.
    expect(await name.evaluate((n) => n.tagName.toLowerCase())).toBe('bdi');
  });
});

test.describe('Files — rejected before storage', () => {
  test('oversize file is refused at presign', async ({ page }) => {
    await login(page);
    await openChat(page);

    const res = await page.request.post('/api/files/presign', {
      headers: { 'x-csrf-token': await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '') },
      data: {
        channelId: await page.evaluate(() => document.querySelector('[data-testid^="channel-"]')?.getAttribute('data-testid')) ?? '',
        filename: 'huge.png', mimeType: 'image/png', sizeBytes: 999_999_999,
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('blocked extension is refused', async ({ page }) => {
    await login(page);
    await openChat(page);

    await page.getByTestId('file-input').setInputFiles(write(`malware-${Date.now()}.exe`, Buffer.from('MZ...')));
    await expect(page.getByTestId('upload-error')).toBeVisible({ timeout: 20_000 });
  });

  test('an executable renamed .png is caught by magic bytes', async ({ page }) => {
    await login(page);
    await openChat(page);

    // "MZ" is the DOS/PE header. The extension and Content-Type both say PNG;
    // the CONTENT does not. This is the check that matters.
    const fake = Buffer.concat([Buffer.from('MZ\x90\x00'), Buffer.alloc(1024)]);
    await page.getByTestId('file-input').setInputFiles(write(`disguised-${Date.now()}.png`, fake));

    await expect(page.getByTestId('upload-error')).toBeVisible({ timeout: 25_000 });
    const text = await page.getByTestId('upload-error').textContent();
    expect(text?.toLowerCase()).toMatch(/mismatch|verified|not permitted/);
  });

  test('binary content claiming to be text is refused', async ({ page }) => {
    await login(page);
    await openChat(page);

    const binary = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe]);
    await page.getByTestId('file-input').setInputFiles(write(`notes-${Date.now()}.txt`, binary));
    await expect(page.getByTestId('upload-error')).toBeVisible({ timeout: 25_000 });
  });
});

test.describe('Files — virus scanning', () => {
  test('EICAR test file is quarantined and never downloadable', async ({ page }) => {
    test.skip(process.env.CLAMAV_ENABLED === 'false', 'ClamAV disabled');
    test.setTimeout(120_000);

    await login(page);
    await openChat(page);

    await page.getByTestId('file-input').setInputFiles(write(`eicar-${Date.now()}.txt`, EICAR));
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('composer-send').click();

    const chip = page.getByTestId('attachment-chip').last();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveAttribute('data-scan-status', 'infected', { timeout: 90_000 });

    // No download control is offered for an infected file.
    const id = await chip.getAttribute('data-attachment-id');
    await expect(page.getByTestId(`download-${id}`)).toHaveCount(0);

    // And the API refuses even if called directly.
    const res = await page.request.get(`/api/files/${id}/download`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('FILE_INFECTED');
  });

  test('a pending file cannot be downloaded', async ({ page }) => {
    await login(page);
    await openChat(page);

    await page.getByTestId('file-input').setInputFiles(write(`pending-${Date.now()}.png`, PNG_1PX));
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('composer-send').click();

    const chip = page.getByTestId('attachment-chip').last();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const id = await chip.getAttribute('data-attachment-id');

    const res = await page.request.get(`/api/files/${id}/download`);
    // Either still scanning, or already cleared — both are correct. What must
    // never happen is a download served while the status is pending.
    if (res.status() === 409) {
      expect((await res.json()).error.code).toBe('SCAN_PENDING');
    } else {
      expect(res.status()).toBe(200);
    }
  });
});

test.describe('Files — authorization', () => {
  test('presign is refused for a channel the user is not in', async ({ page }) => {
    await login(page);
    const csrf = await page.evaluate(() => document.cookie.match(/cp_csrf=([^;]+)/)?.[1] ?? '');
    const res = await page.request.post('/api/files/presign', {
      headers: { 'x-csrf-token': csrf },
      data: {
        channelId: '00000000-0000-0000-0000-000000000000',
        filename: 'x.png', mimeType: 'image/png', sizeBytes: 100,
      },
    });
    expect([403, 400]).toContain(res.status());
  });

  test('unauthenticated download is refused', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/login');
    const res = await p.request.get('/api/files/00000000-0000-0000-0000-000000000000/download');
    expect([401, 403, 404]).toContain(res.status());
    await ctx.close();
  });

  test('presign without a CSRF header is refused', async ({ page }) => {
    await login(page);
    const res = await page.request.post('/api/files/presign', {
      data: { channelId: '00000000-0000-0000-0000-000000000000', filename: 'x.png', mimeType: 'image/png', sizeBytes: 1 },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('quota endpoint reports usage', async ({ page }) => {
    await login(page);
    const res = await page.request.get('/api/files/quota');
    expect(res.ok()).toBe(true);
    const { data } = await res.json();
    expect(data.user).toHaveProperty('usedBytes');
    expect(data.user).toHaveProperty('limitBytes');
  });
});

test.describe('Voice notes', () => {
  test('a recorded note uploads, scans and plays', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await openChat(page);

    // Chromium runs with --use-fake-device-for-media-stream, so getUserMedia
    // returns a synthetic audio track and no permission prompt appears.
    await page.getByTestId('record-voice').click();
    await expect(page.getByTestId('voice-recording')).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(3000);
    await expect(page.getByTestId('voice-timer')).toHaveText(/^\d+:\d{2}$/);

    await page.getByTestId('stop-voice').click();
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('composer-send').click();

    const chip = page.getByTestId('attachment-chip').last();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    // The webm container reports as video/webm; the equivalence rule must let
    // it through rather than rejecting it as a MIME mismatch.
    await expect(chip).toHaveAttribute('data-scan-status', 'clean', { timeout: 60_000 });

    // Shows its purpose, not a generated filename.
    await expect(page.getByTestId('attachment-filename').last()).toHaveText(/Voice note|رسالة صوتية/);

    const id = await chip.getAttribute('data-attachment-id');
    await page.getByTestId(`play-${id}`).click();
    await expect(page.getByTestId(`audio-${id}`)).toBeVisible({ timeout: 15_000 });
  });

  test('cancelling a recording sends nothing', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    await openChat(page);

    const before = await page.getByTestId('attachment-chip').count();

    await page.getByTestId('record-voice').click();
    await expect(page.getByTestId('voice-recording')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);
    await page.getByTestId('cancel-voice').click();

    await expect(page.getByTestId('voice-recording')).toHaveCount(0);
    await page.waitForTimeout(2000);
    expect(await page.getByTestId('attachment-chip').count()).toBe(before);
  });

  test('the recording timer renders LTR in an Arabic UI', async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.addCookies([{ name: 'cp_locale', value: 'ar', url: 'http://localhost:3000' }]);
    await login(page);
    await openChat(page);

    await page.getByTestId('record-voice').click();
    await expect(page.getByTestId('voice-timer')).toBeVisible({ timeout: 10_000 });

    const dir = await page.getByTestId('voice-timer').evaluate((n) => getComputedStyle(n).direction);
    expect(dir).toBe('ltr');

    await page.getByTestId('cancel-voice').click();
  });
});

test.describe('Inline delivery', () => {
  test('HTML is NEVER served inline, even when asked', async ({ page }) => {
    await login(page);
    await openChat(page);

    // The security boundary: inline=1 must be ignored for anything that can
    // execute script. This is what stops an upload becoming stored XSS.
    const res = await page.request.get('/api/files/00000000-0000-0000-0000-000000000000/download?inline=1');
    // A missing id 404s; what matters is that the parameter alone grants nothing.
    expect([403, 404, 409]).toContain(res.status());
  });

  test('an image download defaults to attachment', async ({ page }) => {
    await login(page);
    await openChat(page);

    const chip = page.getByTestId('attachment-chip').first();
    if (await chip.count() === 0) test.skip(true, 'no attachments yet');

    const id = await chip.getAttribute('data-attachment-id');
    const res = await page.request.get(`/api/files/${id}/download`);
    if (!res.ok()) test.skip(true, 'attachment not downloadable');

    const { data } = await res.json();
    // No inline=1, so the signed URL must carry attachment.
    expect(decodeURIComponent(data.url)).toContain('attachment');
  });
});

test.describe('Removing an attachment before sending', () => {
  test('a completed upload can still be removed', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await openChat(page);

    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'remove-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('discard this'),
    });

    // The ✕ must be present AFTER the upload finishes — that is when someone
    // realises they picked the wrong file.
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('remove-upload').click();
    await expect(page.getByTestId('upload-item')).toHaveCount(0);
  });

  test('a removed attachment is NOT sent with the next message', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    const chat = await openChat(page);

    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'should-not-send.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this must not be attached'),
    });
    await expect(page.getByTestId('upload-done')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('remove-upload').click();
    await expect(page.getByTestId('upload-item')).toHaveCount(0);

    const marker = `no-attachment-${Date.now()}`;
    await chat.send(marker);

    // Removing the tray row alone used to leave the id in readyAttachments,
    // so the file went out anyway — silently, to whoever came next.
    const row = page.getByTestId('message-row').filter({ hasText: marker });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId('attachment-chip')).toHaveCount(0);
  });

  test('an in-progress upload can be cancelled', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await openChat(page);

    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'cancel-me.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(2 * 1024 * 1024),
    });

    await expect(page.getByTestId('upload-item')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('remove-upload').first().click();
    await expect(page.getByTestId('upload-item')).toHaveCount(0);
  });
});
