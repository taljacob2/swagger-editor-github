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
  /store/order:
    post:
      summary: Place an order
      tags: [store]
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

test.describe('Operation filter checkboxes in the Preview pane', () => {
  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
    await page.evaluate((spec) => {
      (window as unknown as MonacoWindow).monaco.getModel().setValue(spec);
    }, SPEC);
    await page.waitForTimeout(600);
  });

  test('shows a checked checkbox on every rendered operation', async ({ page }) => {
    await expect(
      page
        .locator('.opblock', { hasText: '/pet' })
        .first()
        .locator('.swagger-editor__operation-filter-checkbox input')
    ).toBeChecked();
    await expect(
      page
        .locator('.opblock', { hasText: '/pet/findByStatus' })
        .locator('.swagger-editor__operation-filter-checkbox input')
    ).toBeChecked();
  });

  test('unchecking a box removes that operation from both the editor and the preview', async ({
    page,
  }) => {
    const findByStatusBlock = page.locator('.opblock', { hasText: '/pet/findByStatus' });
    // Not .uncheck() -- that waits to confirm the box ends up unchecked, but
    // this checkbox's whole row is removed from the DOM the instant it's
    // clicked (see OperationSummaryWrapper.jsx), so there's never an
    // "unchecked" state to observe.
    await findByStatusBlock.locator('.swagger-editor__operation-filter-checkbox input').click();

    await expect(findByStatusBlock).toHaveCount(0);

    const editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent).not.toContain('findByStatus');
    // The Pet schema is still reachable from the surviving POST /pet
    // operation, so it must not have been pruned away.
    expect(editorContent).toContain('Pet:');
  });

  test('a removed operation can be restored from the banner', async ({ page }) => {
    await page
      .locator('.opblock', { hasText: '/pet/findByStatus' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();

    await expect(page.locator('.swagger-editor__removed-operations-title')).toHaveText(
      '1 endpoint removed from this spec'
    );

    await page.locator('.swagger-editor__removed-operations-restore').click();

    await expect(page.locator('.swagger-editor__removed-operations-banner')).toHaveCount(0);
    await expect(page.locator('.opblock', { hasText: '/pet/findByStatus' })).toHaveCount(1);
    const editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent).toContain('findByStatus');
    // It must land back between its original neighbors (/pet before it,
    // /store/order after), not appended at the very end of paths.
    expect(editorContent.indexOf('/pet:')).toBeLessThan(
      editorContent.indexOf('/pet/findByStatus:')
    );
    expect(editorContent.indexOf('/pet/findByStatus:')).toBeLessThan(
      editorContent.indexOf('/store/order:')
    );
  });

  test('"Remove all" on a tag removes every operation under it in one go, leaving other tags alone', async ({
    page,
  }) => {
    // /pet's tag section renders before /store's (spec order), so the first
    // "Remove all" button on the page is its own.
    await page.getByRole('button', { name: 'Remove all' }).first().click();

    await expect(page.locator('.opblock', { hasText: '/pet' })).toHaveCount(0);
    await expect(page.locator('.opblock', { hasText: '/store/order' })).toHaveCount(1);
    await expect(page.locator('.swagger-editor__removed-operations-title')).toHaveText(
      '2 endpoints removed from this spec'
    );
  });

  test('"Restore all" on a tag restores only that tag\'s removed operations', async ({ page }) => {
    await page
      .locator('.opblock', { hasText: '/pet/findByStatus' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();
    await page
      .locator('.opblock', { hasText: '/store/order' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();
    await expect(page.locator('.swagger-editor__removed-operations-title')).toHaveText(
      '2 endpoints removed from this spec'
    );

    // /pet's tag section is still rendered (POST /pet survives), unlike
    // /store's -- its whole section is gone along with its one operation,
    // so its own "Restore all" isn't reachable here (the banner is the only
    // way back for it), which also means this is the only "Restore all"
    // button left on the page.
    await page.getByRole('button', { name: /Restore all/ }).click();

    await expect(page.locator('.opblock', { hasText: '/pet/findByStatus' })).toHaveCount(1);
    await expect(page.locator('.swagger-editor__removed-operations-title')).toHaveText(
      '1 endpoint removed from this spec'
    );
    await expect(page.locator('.opblock', { hasText: '/store/order' })).toHaveCount(0);
  });
});
