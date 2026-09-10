import { test, expect } from '@playwright/test';

import {
  visitBlankPage,
  prepareAsyncAPI,
  prepareOasGenerator,
  waitForSplashScreen,
  clickNestedMenuItem,
} from '../helpers';

/**
 * Dialogs: Confirm
 * Tests for ConfirmDialog and AlertDialog components from the Dialogs plugin
 *
 * TopBar uses the `ConfirmDialog` and `AlertDialog` components
 * from the `Dialogs` plugin, but both are available for use by
 * other plugins and components.
 * The AlertDialog component is generally reserved for unexpected
 * end user error messages, and hopefully not seen in normal use,
 * so we do not currently test it here.
 * Ref: plugin.dropzone.spec.ts contains an E2E assertion for AlertDialog
 *
 * Migrated from: test/cypress/e2e/plugin.dialogs.cy.js
 */
test.describe('Dialogs: Confirm', () => {
  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await prepareOasGenerator(page);
    await waitForSplashScreen(page);
  });

  test('should close the Confirm Dialog via `x` button', async ({ page }) => {
    // Open File > Import URL dialog
    await clickNestedMenuItem(page, 'File', 'Import URL');

    // Dialog should be visible
    await expect(page.locator('#input-import-url')).toBeVisible();

    // Close via X button
    await page.locator('.close').click();

    // Dialog should be closed
    await expect(page.locator('#input-import-url')).not.toBeAttached();
  });

  test('should close the Confirm Dialog via `Cancel` button', async ({ page }) => {
    // Open File > Import URL dialog
    await clickNestedMenuItem(page, 'File', 'Import URL');

    // Dialog should be visible
    await expect(page.locator('#input-import-url')).toBeVisible();

    // Close via Cancel button
    await page.locator('.btn-secondary').click();

    // Dialog should be closed
    await expect(page.locator('#input-import-url')).not.toBeAttached();
  });
});
