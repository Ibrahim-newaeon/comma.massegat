
test.describe('Mobile — reaching profile and sign-out', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a phone user can reach their profile', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    // The icon rail is hidden below md, so without this menu there is no
    // route to the profile at all.
    await expect(page.getByTestId('rail-profile')).toBeHidden();

    await page.getByTestId('mobile-menu-button').click();
    await expect(page.getByTestId('mobile-menu')).toBeVisible();
    await page.getByTestId('mobile-profile').click();
    await page.waitForURL(/\/profile/, { timeout: 10_000 });
  });

  test('a phone user can sign out', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    // The most important one. A shared phone with no way to log out is worse
    // than an inconvenience.
    await page.getByTestId('mobile-menu-button').click();
    await page.getByTestId('mobile-logout').click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test('the menu closes on an outside tap', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    await page.getByTestId('mobile-menu-button').click();
    await expect(page.getByTestId('mobile-menu')).toBeVisible();

    // A menu that only closes via its own button is a trap on a phone.
    await page.getByTestId('message-list').click({ position: { x: 30, y: 200 } });
    await expect(page.getByTestId('mobile-menu')).toHaveCount(0);
  });

  test('the menu is hidden on desktop, where the rail exists', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto('/chat');

    await expect(page.getByTestId('mobile-menu-button')).toBeHidden();
    await expect(page.getByTestId('rail-profile')).toBeVisible();
  });
});

test.describe('Settings reachable on mobile', () => {
  test('chat offers a settings control on a phone', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/chat');

    // Below sm the icon rail is gone and the name link is hidden, so this is
    // the only route to settings.
    await expect(page.getByTestId('header-settings')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('header-settings').click();
    await page.waitForURL(/\/profile/);
  });

  test('the admin console offers settings at every width', async ({ page }) => {
    await login(page);
    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      await page.goto('/admin/users');
      await expect(page.getByTestId('admin-settings')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('profile has a way back — an installed PWA has no browser button', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/profile');

    await expect(page.getByTestId('profile-back')).toBeVisible();
    await page.getByTestId('profile-back').click();
    await page.waitForURL(/\/chat/);
  });
});
