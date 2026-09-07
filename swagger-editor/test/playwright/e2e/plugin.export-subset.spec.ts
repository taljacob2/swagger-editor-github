import { test, expect } from '@playwright/test';

import { visitBlankPage, prepareAsyncAPI, waitForSplashScreen } from '../helpers';
import type { MonacoWindow } from '../helpers/editor-helpers';

const SPEC = `openapi: 3.0.0
info:
  title: Test API
  version: "1.0"
paths:
  /pet:
    post:
      summary: Add a new pet
      tags: [pet]
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
  /pet/findByStatus:
    get:
      summary: Finds Pets by status
      tags: [pet]
      responses:
        '200':
          description: ok
components:
  schemas:
    Pet:
      type: object
      properties:
        name:
          type: string
`;

// The top bar renders two copies of every menu trigger (.menu-item, e.g.
// "File") -- an invisible one TopBar.jsx uses to measure whether the row
// fits before deciding to switch to the compact/hamburger layout, and the
// real, visible one. They're otherwise identical DOM, so a plain
// getByText(...).first() (what clickMenu/clickNestedMenuItem use)
// deterministically resolves to the hidden measurement copy, not the one a
// user can actually click -- :visible filters that out. Once a dropdown is
// open, its entries (DropdownMenuItem) render as .dropdown-item instead.
const clickVisibleMenuItem = (page: import('@playwright/test').Page, text: string) =>
  page.locator('.menu-item:visible, .dropdown-item:visible', { hasText: text }).first().click();

test.describe('Export Subset', () => {
  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
    // Set content directly via Monaco's exposed test API rather than File >
    // Load Example -- that nested menu has its own separate desktop/mobile
    // drill-down duplication, orthogonal to what this file is testing.
    await page.evaluate((spec) => {
      (window as unknown as MonacoWindow).monaco.getModel().setValue(spec);
    }, SPEC);
    await page.waitForTimeout(600);
  });

  test('lists every endpoint checked by default, and exports only what stays checked', async ({
    page,
  }) => {
    await clickVisibleMenuItem(page, 'File');
    await clickVisibleMenuItem(page, 'Export Subset');

    const postPet = page.getByRole('checkbox', { name: /POST.*\/pet\b/ });
    const findByStatus = page.getByRole('checkbox', { name: /GET.*\/pet\/findByStatus/ });
    await expect(postPet).toBeChecked();
    await expect(findByStatus).toBeChecked();
    await expect(page.locator('.swagger-editor__export-subset-count')).toHaveText(
      '2 of 2 endpoints selected'
    );

    await findByStatus.uncheck();
    await expect(page.locator('.swagger-editor__export-subset-count')).toHaveText(
      '1 of 2 endpoints selected'
    );

    const downloadPromise = page.waitForEvent('download');
    await page.getByText('Export', { exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('openapi3_0-subset.yaml');
    const content = await download.createReadStream().then(
      (stream) =>
        new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          stream.on('error', reject);
        })
    );
    expect(content).toContain('/pet');
    expect(content).not.toContain('findByStatus');
    // The Pet schema is still reachable from the surviving POST /pet
    // operation, so it must not have been pruned away.
    expect(content).toContain('Pet:');
  });

  test('Export is disabled once every endpoint is unchecked', async ({ page }) => {
    await clickVisibleMenuItem(page, 'File');
    await clickVisibleMenuItem(page, 'Export Subset');

    const checkboxes = page.locator('.swagger-editor__export-subset-row input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await checkboxes.nth(i).uncheck();
    }

    await expect(page.getByText('Export', { exact: true })).toBeDisabled();
  });
});
