// tests/pages/ChatPage.ts
import { expect, type Page } from '@playwright/test';

export class ChatPage {
  constructor(private page: Page) {}

  /**
   * The Next.js dev-tools indicator renders as <nextjs-portal> in the
   * bottom-left corner. In RTL the send button mirrors into that same corner
   * and the portal swallows the click. Production ships no portal.
   */
  private async neutralizeDevOverlay() {
    await this.page.addStyleTag({
      content: 'nextjs-portal, [data-nextjs-dev-overlay] { pointer-events: none !important; }',
    }).catch(() => { /* can fail during navigation; harmless */ });
  }

  readonly composer = () => this.page.getByTestId('composer-input');
  readonly sendButton = () => this.page.getByTestId('composer-send');
  readonly messages = () => this.page.getByTestId('message-body');
  readonly messageRows = () => this.page.getByTestId('message-row');
  readonly connection = () => this.page.getByTestId('connection-status');
  readonly typing = () => this.page.getByTestId('typing-indicator');

  async goto() {
    // Next dev compiles routes on demand. The first hit on /chat can exceed
    // the 5s default expect timeout, which reads as "element not found".
    await this.page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(this.page.getByTestId('chat-pane')).toBeVisible({ timeout: 30000 });
    await this.neutralizeDevOverlay();
    await this.waitForConnection();
  }

  async waitForConnection() {
    await expect(this.connection()).toHaveAttribute('data-connected', 'true', { timeout: 30000 });
  }

  async send(text: string) {
    await this.composer().fill(text);
    await this.sendButton().click();
  }

  async expectMessage(text: string) {
    await expect(this.messages().filter({ hasText: text }).first()).toBeVisible({ timeout: 10_000 });
  }

  /** Asserts the RENDERED direction of a message, not the attribute. */
  async expectMessageDirection(text: string, dir: 'ltr' | 'rtl') {
    const el = this.messages().filter({ hasText: text }).first();
    await expect(el).toBeVisible();
    const computed = await el.evaluate((n) => getComputedStyle(n).direction);
    expect(computed).toBe(dir);
  }

  async expectOwnership(text: string, isOwn: boolean) {
    const row = this.page.getByTestId('message-row').filter({ hasText: text }).first();
    await expect(row).toHaveAttribute('data-own', String(isOwn));
  }

  async selectChannel(slug: string) {
    // Below md the channel list is an off-screen drawer. Open it first, or the
    // target sits outside the viewport and the click never lands.
    const hamburger = this.page.getByTestId('open-channel-list');
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.click();
      await this.page.waitForTimeout(300);
    }
    await this.page.getByTestId(`channel-${slug}`).click();
    await this.page.waitForTimeout(300);
  }

  async unreadCount(slug: string): Promise<number> {
    const badge = this.page.getByTestId(`unread-${slug}`);
    if (await badge.count() === 0) return 0;
    return Number((await badge.textContent()) ?? '0');
  }
}
