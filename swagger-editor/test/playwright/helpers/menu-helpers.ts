import { Page, Locator } from '@playwright/test';

/**
 * Menu Helpers - Top bar menu navigation
 * Reusable patterns for interacting with dropdown menus
 */

/**
 * Locator for a top-level or dropdown menu item by its text.
 *
 * TopBar renders an invisible, always-mounted copy of the menu items ahead of
 * the real, visible copy (used to measure when to switch to compact/hamburger
 * mode) -- see TopBar.jsx. A plain text locator resolves to that hidden copy
 * first, so this intersects with `:visible` to always hit the clickable one.
 * Intersecting rather than restricting to specific classes (`.menu-item`,
 * `.dropdown-item`) because nested submenu triggers like "Load Example" use
 * their own class (`.nested-dd-menu-trigger`) that a class-based locator
 * would miss.
 *
 * @param exact - Defaults to true. Nested submenu triggers append an arrow
 * (e.g. "Load Example  >"), so pass `exact: false` for those.
 */
export function menuItemLocator(page: Page, text: string, exact = true): Locator {
  return page.getByText(text, { exact }).and(page.locator(':visible')).first();
}

/**
 * Click a top-level menu item (File, Edit, Generate, etc.)
 */
export async function clickMenu(page: Page, menuName: string): Promise<void> {
  await menuItemLocator(page, menuName).click();
}

/**
 * Click a nested menu item (e.g., File > Load Example > Petstore OpenAPI 3.0)
 * Automatically handles hovering over intermediate menu items with proper waits
 *
 * @param page - Playwright page object
 * @param topMenu - Top-level menu name (e.g., "File")
 * @param subMenuItems - Array of submenu items to navigate through
 *
 * @example
 * // Click File > Load Example > Petstore OpenAPI 3.0
 * await clickNestedMenuItem(page, 'File', 'Load Example', 'Petstore OpenAPI 3.0');
 */
export async function clickNestedMenuItem(
  page: Page,
  topMenu: string,
  ...subMenuItems: string[]
): Promise<void> {
  // Click top-level menu and wait for it to be visible
  const topMenuItem = menuItemLocator(page, topMenu);
  await topMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await topMenuItem.click();

  // Wait for menu to open
  await page.waitForTimeout(300);

  // Hover over intermediate menu items (all except the last one)
  for (let i = 0; i < subMenuItems.length - 1; i++) {
    // Don't use exact match because menu items may have arrows (">") appended
    const menuItem = menuItemLocator(page, subMenuItems[i], false);
    // Wait for submenu item to be visible before hovering
    await menuItem.waitFor({ state: 'visible', timeout: 10000 });
    await menuItem.hover();
    // Small delay to allow submenu to fully open
    await page.waitForTimeout(300);
  }

  // Click the final menu item
  const lastItem = subMenuItems[subMenuItems.length - 1];
  // Don't use exact match because menu items may have arrows (">") appended
  const finalMenuItem = menuItemLocator(page, lastItem, false);
  await finalMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await finalMenuItem.click();
}

/**
 * Load an example file from File > Load Example menu
 * Common shortcut for test setup
 *
 * @param page - Playwright page object
 * @param exampleName - Name of the example to load (e.g., "Petstore OpenAPI 3.0")
 */
export async function loadExample(page: Page, exampleName: string): Promise<void> {
  await clickNestedMenuItem(page, 'File', 'Load Example', exampleName);
}

/**
 * Clear editor content via Edit > Clear Editor menu
 */
export async function clearEditor(page: Page): Promise<void> {
  await clickNestedMenuItem(page, 'Edit', 'Clear Editor');
}

/**
 * Convert to OpenAPI 3 via Edit > Convert to OpenAPI 3 menu
 */
export async function convertToOpenAPI3(page: Page): Promise<void> {
  await clickNestedMenuItem(page, 'Edit', 'Convert to OpenAPI 3');
}

/**
 * Generate server code via Generate > Server menu
 *
 * @param page - Playwright page object
 * @param serverName - Server generator name (e.g., "nodejs-server")
 */
export async function generateServer(page: Page, serverName: string): Promise<void> {
  await clickNestedMenuItem(page, 'Generate', 'Server', serverName);
}

/**
 * Generate client code via Generate > Client menu
 *
 * @param page - Playwright page object
 * @param clientName - Client generator name (e.g., "javascript")
 */
export async function generateClient(page: Page, clientName: string): Promise<void> {
  await clickNestedMenuItem(page, 'Generate', 'Client', clientName);
}

/**
 * Wait for a menu to be visible
 * Useful for assertions or waiting for dynamic content to load
 */
export async function waitForMenu(page: Page, menuName: string): Promise<void> {
  await menuItemLocator(page, menuName).waitFor({ state: 'visible' });
}

/**
 * Check if a menu item is visible
 */
export async function isMenuVisible(page: Page, menuName: string): Promise<boolean> {
  return menuItemLocator(page, menuName).isVisible();
}
