// tests/pages/AdminPage.ts
import { expect, type Page } from '@playwright/test';

export class AdminPage {
  constructor(private page: Page) {}

  readonly usersTable = () => this.page.getByTestId('users-table');
  readonly toggleCreate = () => this.page.getByTestId('toggle-create-user');
  readonly newEmail = () => this.page.getByTestId('new-user-email');
  readonly newName = () => this.page.getByTestId('new-user-name');
  readonly newNameAr = () => this.page.getByTestId('new-user-name-ar');
  readonly newRole = () => this.page.getByTestId('new-user-role');
  readonly submitCreate = () => this.page.getByTestId('submit-create-user');
  readonly setupLink = () => this.page.getByTestId('setup-link');
  readonly error = () => this.page.getByTestId('admin-error');

  async gotoUsers() {
    await this.page.goto('/admin/users');
    await expect(this.usersTable()).toBeVisible({ timeout: 30000 });
  }

  async gotoAudit() {
    await this.page.goto('/admin/audit');
  }

  /** Creates a user and returns the one-time setup URL. */
  async createUser(email: string, name: string, role = 'member', nameAr?: string): Promise<string> {
    await this.toggleCreate().click();
    await this.newEmail().fill(email);
    await this.newName().fill(name);
    if (nameAr) await this.newNameAr().fill(nameAr);
    await this.newRole().selectOption(role);
    await this.submitCreate().click();
    await expect(this.setupLink()).toBeVisible();
    return (await this.setupLink().textContent()) ?? '';
  }

  async deactivate(email: string) {
    await this.page.getByTestId(`toggle-active-${email}`).click();
  }

  async expectStatus(email: string, status: 'Active' | 'Inactive' | 'نشط' | 'غير نشط') {
    await expect(this.page.getByTestId(`status-${email}`)).toHaveText(status);
  }

  async expectAuditContains(action: string) {
    await this.gotoAudit();
    await expect(this.page.getByTestId(`audit-row-${action}`).first()).toBeVisible();
  }
}
