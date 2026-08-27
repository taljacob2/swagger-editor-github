import { test, expect } from '@playwright/test';

import { visitBlankPage, prepareAsyncAPI, waitForSplashScreen } from '../helpers';

/**
 * Theme
 * Tests for the Light/Semi-dark/Dark theme toggle (a 3-way segmented pill)
 * in the top bar.
 */
test.describe('Theme', () => {
  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
  });

  const option = (page, mode) =>
    page.locator(`.swagger-editor__top-bar-theme-toggle-option[data-mode="${mode}"]`);

  test('defaults to semi-dark: dark editor, light chrome/preview', async ({ page }) => {
    const monacoEditor = page.locator('.monaco-editor').first();

    // afterLoad seeds state via setThemeMode(getStoredThemeMode()), and that
    // action creator persists as a side effect -- so the default is already
    // written back to localStorage after the very first load, same as if
    // the user had picked it explicitly.
    const stored = await page.evaluate(() => localStorage.getItem('swagger-editor:theme-mode'));
    expect(stored).toBe('semi-dark');

    await expect(option(page, 'semi-dark')).toHaveAttribute('aria-checked', 'true');

    // Monaco itself follows the *editor* theme (dark)...
    await expect(monacoEditor).toHaveClass(/vs-dark/);
    // ...while the app chrome/preview stays on the light scope.
    await expect(page.locator('.swagger-editor__theme-root')).toHaveAttribute(
      'data-theme',
      'light'
    );
    await expect(page.locator('html')).not.toHaveClass(/dark-mode/);
  });

  test('selecting a segment jumps straight to that mode and updates data-theme', async ({
    page,
  }) => {
    const themeRoot = page.locator('.swagger-editor__theme-root');

    // Starting mode is 'semi-dark' (the default): chrome/preview resolve
    // light, only the editor is dark.
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');

    await option(page, 'dark').click();
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');
    await expect(option(page, 'dark')).toHaveAttribute('aria-checked', 'true');
    await expect(option(page, 'light')).toHaveAttribute('aria-checked', 'false');

    await option(page, 'light').click();
    await expect(themeRoot).toHaveAttribute('data-theme', 'light');
    await expect(option(page, 'light')).toHaveAttribute('aria-checked', 'true');

    // Jumping directly from light to dark, skipping semi-dark entirely --
    // this is the point of a segmented control over a cycling button.
    await option(page, 'dark').click();
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');
  });

  test('the sliding highlight tracks the active segment', async ({ page }) => {
    const highlight = page.locator('.swagger-editor__top-bar-theme-toggle-highlight');

    // Default is semi-dark (index 1) -- record its transform, then confirm
    // each other selection moves the highlight to a distinct position.
    const atSemiDark = await highlight.evaluate((el) => getComputedStyle(el).transform);

    // Wait for the click's React re-render to actually land (aria-checked
    // flipping is the signal) before reading the transform -- otherwise
    // this can race the update and read the pre-click value.
    await option(page, 'light').click();
    await expect(option(page, 'light')).toHaveAttribute('aria-checked', 'true');
    const atLight = await highlight.evaluate((el) => getComputedStyle(el).transform);
    expect(atLight).not.toBe(atSemiDark);

    await option(page, 'dark').click();
    await expect(option(page, 'dark')).toHaveAttribute('aria-checked', 'true');
    const atDark = await highlight.evaluate((el) => getComputedStyle(el).transform);
    expect(atDark).not.toBe(atSemiDark);
    expect(atDark).not.toBe(atLight);
  });

  test('persists the chosen mode across a reload', async ({ page }) => {
    const themeRoot = page.locator('.swagger-editor__theme-root');

    await option(page, 'dark').click();
    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await waitForSplashScreen(page);

    await expect(themeRoot).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => localStorage.getItem('swagger-editor:theme-mode'));
    expect(stored).toBe('dark');
  });

  test('applies the dark scope class to modal portals', async ({ page }) => {
    await option(page, 'dark').click();

    await page.getByText('File', { exact: true }).last().click();
    await page.getByText('Import URL', { exact: true }).last().click();

    await expect(page.locator('.ReactModalPortal').first()).toHaveClass(
      /swagger-editor__theme-dark/
    );
  });
});
