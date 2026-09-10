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

// OpenAPI 3.2's QUERY method used to be silently invisible to this filter --
// OPERATION_METHODS in operation-filter-service.js hardcoded the pre-3.2
// method list, so a QUERY operation got no checkbox, and worse, a path
// item containing *only* a QUERY operation would be dropped by
// buildSubsetSpec any time an unrelated operation elsewhere was removed.
test.describe('Operation filter checkboxes support the QUERY method', () => {
  const QUERY_SPEC = `openapi: 3.2.0
info:
  title: Test API
  version: "1.0"
paths:
  /pet/search:
    query:
      summary: Search pets by a complex filter
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
`;

  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
    await page.evaluate((spec) => {
      (window as unknown as MonacoWindow).monaco.getModel().setValue(spec);
    }, QUERY_SPEC);
    await page.waitForTimeout(600);
  });

  test('renders a checked checkbox on a QUERY operation, and unchecking it removes it', async ({
    page,
  }) => {
    const searchBlock = page.locator('.opblock', { hasText: '/pet/search' });
    await expect(
      searchBlock.locator('.swagger-editor__operation-filter-checkbox input')
    ).toBeChecked();

    await searchBlock.locator('.swagger-editor__operation-filter-checkbox input').click();

    await expect(searchBlock).toHaveCount(0);
    const editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent).not.toContain('/pet/search');
  });

  test('removing an unrelated operation does not silently drop a QUERY-only path', async ({
    page,
  }) => {
    await page
      .locator('.opblock', { hasText: '/store/order' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();

    await expect(page.locator('.opblock', { hasText: '/store/order' })).toHaveCount(0);
    const editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent).toContain('/pet/search');
    expect(editorContent).toContain('query:');
  });
});

// Restoring an operation used to put its tag back at the end of the
// top-level tags: list (same append-only bug the paths ordering fix
// addressed), instead of back where it was among its sibling tags.
test.describe('Restoring an operation puts its tag section back in place', () => {
  const TAGGED_SPEC = `openapi: 3.0.0
info:
  title: Test API
  version: "1.0"
tags:
  - name: pet
  - name: store
  - name: user
paths:
  /pet:
    get:
      summary: List pets
      tags: [pet]
      responses:
        '200':
          description: ok
  /pet/findByStatus:
    get:
      summary: Finds pets by status
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
  /user:
    post:
      summary: Create a user
      tags: [user]
      responses:
        '200':
          description: ok
`;

  test.beforeEach(async ({ page }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);
    await page.evaluate((spec) => {
      (window as unknown as MonacoWindow).monaco.getModel().setValue(spec);
    }, TAGGED_SPEC);
    await page.waitForTimeout(600);
  });

  test("restoring the middle tag's only operation reinserts it between its original neighbors", async ({
    page,
  }) => {
    await page
      .locator('.opblock', { hasText: '/store/order' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();

    let editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent).not.toContain('name: store');

    await page.locator('.swagger-editor__removed-operations-restore').click();

    editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent).toContain('name: store');
    expect(editorContent.indexOf('name: pet')).toBeLessThan(editorContent.indexOf('name: store'));
    expect(editorContent.indexOf('name: store')).toBeLessThan(editorContent.indexOf('name: user'));
  });

  test("restoring a whole tag's operations one by one from the banner reproduces the original path and tag order", async ({
    page,
  }) => {
    // pet has two operations (/pet, /pet/findByStatus) -- removing both
    // together used to corrupt findByStatus's own recorded position,
    // since by the time its removal was processed, /pet had already been
    // removed earlier in the same "Remove all" batch.
    await page.getByRole('button', { name: 'Remove all' }).first().click();

    await expect(page.locator('.swagger-editor__removed-operations-title')).toHaveText(
      '2 endpoints removed from this spec'
    );

    // No "Restore all" for pet is reachable once its whole section is
    // gone -- restore both from the banner, one at a time, same as a user
    // clicking "Restore" repeatedly.
    while ((await page.locator('.swagger-editor__removed-operations-restore').count()) > 0) {
      // eslint-disable-next-line no-await-in-loop
      await page.locator('.swagger-editor__removed-operations-restore').first().click();
    }
    await expect(page.locator('.swagger-editor__removed-operations-banner')).toHaveCount(0);

    const editorContent = await page.evaluate(() =>
      (window as unknown as MonacoWindow).monaco.getModel().getValue()
    );
    expect(editorContent.indexOf('/pet:')).toBeLessThan(
      editorContent.indexOf('/pet/findByStatus:')
    );
    expect(editorContent.indexOf('/pet/findByStatus:')).toBeLessThan(
      editorContent.indexOf('/store/order:')
    );
    expect(editorContent.indexOf('name: pet')).toBeLessThan(editorContent.indexOf('name: store'));
    expect(editorContent.indexOf('name: store')).toBeLessThan(editorContent.indexOf('name: user'));
  });
});

// The removed-operations banner used to keep showing whichever tab it last
// picked up, regardless of which tab was actually active -- TabBar.jsx
// updates its own React state directly on a switch, but (before this fix)
// never announced the change via notifyWorkspaceChanged(), which is the
// only way the banner (built after TabBar, on the same
// getWorkspaceMeta/onWorkspaceChanged pattern) finds out a switch happened.
test.describe('The removed-operations banner is scoped to the active tab', () => {
  const SPEC_A = `openapi: 3.0.0
info:
  title: A
  version: "1.0"
paths:
  /pet:
    get:
      summary: List pets
      responses:
        '200':
          description: ok
`;
  const SPEC_B = `openapi: 3.0.0
info:
  title: B
  version: "1.0"
paths:
  /order:
    get:
      summary: List orders
      responses:
        '200':
          description: ok
`;

  test("switching tabs (by click or keyboard shortcut) shows each tab's own removed operations, not the other tab's", async ({
    page,
  }) => {
    await visitBlankPage(page);
    await prepareAsyncAPI(page);
    await waitForSplashScreen(page);

    const bannerPaths = () =>
      page
        .locator(
          '.swagger-editor__removed-operations-item .swagger-editor__removed-operations-path'
        )
        .allTextContents();

    // Tab 1: remove /pet.
    await page.evaluate((spec) => {
      (window as unknown as MonacoWindow).monaco.getModel().setValue(spec);
    }, SPEC_A);
    await page.waitForTimeout(600);
    await page
      .locator('.opblock', { hasText: '/pet' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();
    await expect.poll(bannerPaths).toEqual(['/pet']);

    // New tab: remove /order.
    await page.locator('.swagger-editor__tab-add').click();
    await page.waitForTimeout(300);
    await page.evaluate((spec) => {
      (window as unknown as MonacoWindow).monaco.getModel().setValue(spec);
    }, SPEC_B);
    await page.waitForTimeout(600);
    await page
      .locator('.opblock', { hasText: '/order' })
      .locator('.swagger-editor__operation-filter-checkbox input')
      .click();
    await expect.poll(bannerPaths).toEqual(['/order']);

    // Back to tab 1 by clicking its name -- must show /pet again, not /order.
    await page.locator('.swagger-editor__tab-name').first().click();
    await expect.poll(bannerPaths).toEqual(['/pet']);

    // Alt+2 / Alt+1 keyboard shortcuts must scope the banner the same way.
    await page.keyboard.press('Alt+2');
    await expect.poll(bannerPaths).toEqual(['/order']);
    await page.keyboard.press('Alt+1');
    await expect.poll(bannerPaths).toEqual(['/pet']);
  });
});
