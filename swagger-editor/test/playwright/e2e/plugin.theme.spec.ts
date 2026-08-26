import { test, expect } from '@playwright/test';

import { visitBlankPage, prepareAsyncAPI, waitForSplashScreen } from '../helpers';

/**
 * Theme
 * Tests for the Light/Dark/System theme toggle in the top bar.
 */
test.describe('Theme', () => {
  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
  });

  test('cycles light -> dark -> system -> light and updates data-theme', async ({ page }) => {
    const themeRoot = page.locator('.swagger-editor__theme-root');
    const toggle = page.locator('.swagger-editor__top-bar-theme-toggle');

    // Starting mode is 'system'; in a headless browser with no explicit
    // color-scheme emulation, prefers-color-scheme resolves to light.
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');

    await toggle.click(); // system -> light (still resolves to light)
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');

    await toggle.click(); // light -> dark
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');

    await toggle.click(); // dark -> system (resolves to light again)
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');
  });

  test('persists the chosen mode across a reload', async ({ page }) => {
    const themeRoot = page.locator('.swagger-editor__theme-root');
    const toggle = page.locator('.swagger-editor__top-bar-theme-toggle');

    await toggle.click(); // system -> light
    await toggle.click(); // light -> dark
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await waitForSplashScreen(page);

    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => localStorage.getItem('swagger-editor:theme-mode'));
    expect(stored).toBe('dark');
  });

  test('applies the dark scope class to modal portals', async ({ page }) => {
    const toggle = page.locator('.swagger-editor__top-bar-theme-toggle');
    await toggle.click(); // system -> light
    await toggle.click(); // light -> dark

    await page.getByText('File', { exact: true }).last().click();
    await page.getByText('Import URL', { exact: true }).last().click();

    await expect(page.locator('.ReactModalPortal').first()).toHaveClass(
      /swagger-editor__theme-dark/
    );
  });
});
