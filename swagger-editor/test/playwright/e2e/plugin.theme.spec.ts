import { test, expect } from '@playwright/test';

import { visitBlankPage, prepareAsyncAPI, waitForSplashScreen } from '../helpers';

/**
 * Theme
 * Tests for the Light/Semi-dark/Dark theme toggle in the top bar.
 */
test.describe('Theme', () => {
  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
  });

  test('defaults to semi-dark: dark editor, light chrome/preview', async ({ page }) => {
    const monacoEditor = page.locator('.monaco-editor').first();

    // afterLoad seeds state via setThemeMode(getStoredThemeMode()), and that
    // action creator persists as a side effect -- so the default is already
    // written back to localStorage after the very first load, same as if
    // the user had picked it explicitly.
    const stored = await page.evaluate(() => localStorage.getItem('swagger-editor:theme-mode'));
    expect(stored).toBe('semi-dark');

    // Monaco itself follows the *editor* theme (dark)...
    await expect(monacoEditor).toHaveClass(/vs-dark/);
    // ...while the app chrome/preview stays on the light scope.
    await expect(page.locator('.swagger-editor__theme-root')).toHaveAttribute(
      'data-theme',
      'light'
    );
    await expect(page.locator('html')).not.toHaveClass(/dark-mode/);
  });

  test('cycles light -> semi-dark -> dark -> light and updates data-theme', async ({ page }) => {
    const themeRoot = page.locator('.swagger-editor__theme-root');
    const toggle = page.locator('.swagger-editor__top-bar-theme-toggle');

    // Starting mode is 'semi-dark' (the default): chrome/preview resolve
    // light, only the editor is dark.
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');

    await toggle.click(); // semi-dark -> dark
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');

    await toggle.click(); // dark -> light
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');

    await toggle.click(); // light -> semi-dark
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');
  });

  test('persists the chosen mode across a reload', async ({ page }) => {
    const themeRoot = page.locator('.swagger-editor__theme-root');
    const toggle = page.locator('.swagger-editor__top-bar-theme-toggle');

    await toggle.click(); // semi-dark -> dark
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await waitForSplashScreen(page);

    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => localStorage.getItem('swagger-editor:theme-mode'));
    expect(stored).toBe('dark');
  });

  test('applies the dark scope class to modal portals', async ({ page }) => {
    const toggle = page.locator('.swagger-editor__top-bar-theme-toggle');
    await toggle.click(); // semi-dark -> dark

    await page.getByText('File', { exact: true }).last().click();
    await page.getByText('Import URL', { exact: true }).last().click();

    await expect(page.locator('.ReactModalPortal').first()).toHaveClass(
      /swagger-editor__theme-dark/
    );
  });
});
