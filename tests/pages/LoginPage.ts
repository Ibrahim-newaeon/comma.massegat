// tests/pages/LoginPage.ts
import { expect, type Page } from '@playwright/test';
import { currentTotpCode } from '../helpers/totp';

export class LoginPage {
  constructor(private page: Page) {}

  readonly email = () => this.page.getByTestId('email-input');
  readonly password = () => this.page.getByTestId('password-input');
  readonly totp = () => this.page.getByTestId('totp-input');
  readonly submit = () => this.page.getByTestId('login-submit');
  readonly error = () => this.page.getByTestId('login-error');
  readonly localeSwitch = () => this.page.getByTestId('locale-switch');

  async goto() {
    await this.page.goto('/login');
    await expect(this.page.getByTestId('login-form')).toBeVisible();
  }

  /** Signs in, completing TOTP if the account has it enrolled. */
  async login(email: string, password: string) {
    await this.email().fill(email);
    await this.password().fill(password);
    await this.submit().click();

    const needsTotp = await this.totp()
      .waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

    if (needsTotp) {
      const code = await currentTotpCode(email);
      if (!code) throw new Error(`${email} was asked for a TOTP code but has none enrolled.`);
      await this.totp().fill(code);
      await this.submit().click();
    }
    await this.page.waitForTimeout(600);
  }

  /** Signs in WITHOUT handling TOTP — for negative tests. */
  async loginRaw(email: string, password: string) {
    await this.email().fill(email);
    await this.password().fill(password);
    await this.submit().click();
  }

  async setLocale(locale: 'en' | 'ar') {
    await this.page.context().addCookies([
      { name: 'cp_locale', value: locale, url: this.page.url() || 'http://localhost:3000' },
    ]);
    await this.page.reload();
  }

  async expectUiDirection(dir: 'ltr' | 'rtl') {
    await expect(this.page.locator('html')).toHaveAttribute('dir', dir);
  }

  async expectGenericError() {
    await expect(this.error()).toBeVisible();
    const text = (await this.error().textContent()) ?? '';
    expect(text.toLowerCase()).not.toContain('not found');
    expect(text.toLowerCase()).not.toContain('no such user');
    expect(text.toLowerCase()).not.toContain('deactivated');
  }
}
