// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// Loads TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD and TOTP_ENCRYPTION_KEY.
config();

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: false,          // shared DB state
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60_000,   // two-party socket tests need headroom
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    // Calls need a camera and microphone. These flags give Chromium a
    // synthetic stream and auto-grant permission, so no prompt blocks the run.
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-file-access-from-files',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium-en', use: { ...devices['Desktop Chrome'], locale: 'en-US' } },
    // Entire suite runs a second time in Arabic — RTL is a first-class test axis.
    { name: 'chromium-ar', use: { ...devices['Desktop Chrome'], locale: 'ar-SA' } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
