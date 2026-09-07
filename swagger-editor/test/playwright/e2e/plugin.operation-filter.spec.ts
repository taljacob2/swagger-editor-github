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
});
