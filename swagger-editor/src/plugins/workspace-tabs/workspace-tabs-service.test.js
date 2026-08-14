import {
  addTab,
  closeTab,
  copyTabContentToClipboard,
  duplicateTab,
  getActiveTab,
  getTabContent,
  getWorkspaceMeta,
  removeTabContent,
  renameTab,
  saveWorkspaceMeta,
  setActiveTab,
  setTabContent,
} from './workspace-tabs-service.js';

describe('workspace-tabs-service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getWorkspaceMeta', () => {
    test('migrates a pre-existing legacy single-content key into "Tab 1"', () => {
      localStorage.setItem('swagger-editor-content', 'openapi: 3.0.0\n');

      const meta = getWorkspaceMeta();

      expect(meta.tabs).toHaveLength(1);
      expect(meta.tabs[0].name).toBe('Tab 1');
      expect(meta.activeTabId).toBe(meta.tabs[0].id);
      expect(getTabContent(meta.tabs[0].id)).toBe('openapi: 3.0.0\n');
      expect(localStorage.getItem('swagger-editor-content')).toBeNull();
    });

    test('builds a fresh empty "Tab 1" when nothing is stored at all', () => {
      const meta = getWorkspaceMeta();

      expect(meta.tabs).toEqual([{ id: expect.any(String), name: 'Tab 1' }]);
      expect(meta.activeTabId).toBe(meta.tabs[0].id);
      expect(getTabContent(meta.tabs[0].id)).toBe('');
    });

    test('falls back to a fresh default when stored JSON is corrupt', () => {
      localStorage.setItem('workspace-tabs', 'not json');

      const meta = getWorkspaceMeta();

      expect(meta.tabs).toHaveLength(1);
      expect(meta.tabs[0].name).toBe('Tab 1');
    });

    test('returns a previously saved (already-split) workspace unchanged', () => {
      const saved = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'a' };
      saveWorkspaceMeta(saved);

      expect(getWorkspaceMeta()).toEqual(saved);
    });

    test("migrates the previous inline-content shape, splitting each tab's content into its own key", () => {
      localStorage.setItem(
        'workspace-tabs',
        JSON.stringify({
          tabs: [
            { id: 'a', name: 'Tab 1', content: 'a-content' },
            { id: 'b', name: 'Tab 2', content: 'b-content' },
          ],
          activeTabId: 'b',
        })
      );

      const meta = getWorkspaceMeta();

      expect(meta).toEqual({
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'b',
      });
      expect(getTabContent('a')).toBe('a-content');
      expect(getTabContent('b')).toBe('b-content');
      // the migrated metadata itself must not carry content, or every future
      // save would go right back to reserializing all tabs' content again
      expect(JSON.parse(localStorage.getItem('workspace-tabs')).tabs[0].content).toBeUndefined();
    });
  });

  describe('getTabContent / setTabContent / removeTabContent', () => {
    test("round-trips a tab's content independently of the metadata blob", () => {
      setTabContent('a', 'hello');
      setTabContent('b', 'world');

      expect(getTabContent('a')).toBe('hello');
      expect(getTabContent('b')).toBe('world');
    });

    test('returns an empty string for a tab with no stored content', () => {
      expect(getTabContent('missing')).toBe('');
    });

    test("removeTabContent clears only that tab's key", () => {
      setTabContent('a', 'hello');
      setTabContent('b', 'world');

      removeTabContent('a');

      expect(getTabContent('a')).toBe('');
      expect(getTabContent('b')).toBe('world');
    });

    test("setting one tab's content never touches another tab's stored content", () => {
      setTabContent('a', 'hello');
      setTabContent('b', 'world');

      setTabContent('a', 'hello, edited');

      expect(getTabContent('b')).toBe('world');
    });
  });

  describe('getActiveTab', () => {
    test('returns the tab matching activeTabId', () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'b',
      };

      expect(getActiveTab(meta)).toEqual({ id: 'b', name: 'Tab 2' });
    });

    test('falls back to the first tab when activeTabId matches nothing', () => {
      const meta = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'missing' };

      expect(getActiveTab(meta)).toEqual({ id: 'a', name: 'Tab 1' });
    });
  });

  describe('addTab', () => {
    test('appends a new sequentially-named tab and makes it active', () => {
      const meta = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'a' };

      const next = addTab(meta);

      expect(next.tabs).toHaveLength(2);
      expect(next.tabs[1]).toMatchObject({ name: 'Tab 2' });
      expect(next.activeTabId).toBe(next.tabs[1].id);
    });
  });

  describe('duplicateTab', () => {
    test("inserts a copy right after the source tab and activates it (content is the caller's job)", () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'a',
      };

      const next = duplicateTab(meta, 'a');

      expect(next.tabs.map((tab) => tab.name)).toEqual(['Tab 1', 'Tab 1 copy', 'Tab 2']);
      expect(next.activeTabId).toBe(next.tabs[1].id);
    });

    test('is a no-op when the tab id does not exist', () => {
      const meta = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'a' };

      expect(duplicateTab(meta, 'missing')).toBe(meta);
    });
  });

  describe('closeTab', () => {
    test('refuses to close the last remaining tab', () => {
      const meta = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'a' };

      expect(closeTab(meta, 'a')).toBe(meta);
    });

    test('removes a non-active tab without changing activeTabId', () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'a',
      };

      const next = closeTab(meta, 'b');

      expect(next.tabs.map((tab) => tab.id)).toEqual(['a']);
      expect(next.activeTabId).toBe('a');
    });

    test('closing the active tab activates the previous tab in the list', () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
          { id: 'c', name: 'Tab 3' },
        ],
        activeTabId: 'b',
      };

      const next = closeTab(meta, 'b');

      expect(next.tabs.map((tab) => tab.id)).toEqual(['a', 'c']);
      expect(next.activeTabId).toBe('a');
    });

    test('closing the first (active) tab activates the new first tab', () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'a',
      };

      const next = closeTab(meta, 'a');

      expect(next.tabs.map((tab) => tab.id)).toEqual(['b']);
      expect(next.activeTabId).toBe('b');
    });
  });

  describe('setActiveTab', () => {
    test('updates activeTabId when the tab exists', () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'a',
      };

      expect(setActiveTab(meta, 'b').activeTabId).toBe('b');
    });

    test('is a no-op when the tab id does not exist', () => {
      const meta = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'a' };

      expect(setActiveTab(meta, 'missing')).toBe(meta);
    });
  });

  describe('renameTab', () => {
    test('renames only the matching tab, trimming surrounding whitespace', () => {
      const meta = {
        tabs: [
          { id: 'a', name: 'Tab 1' },
          { id: 'b', name: 'Tab 2' },
        ],
        activeTabId: 'a',
      };

      const next = renameTab(meta, 'a', '  My API  ');

      expect(next.tabs).toEqual([
        { id: 'a', name: 'My API' },
        { id: 'b', name: 'Tab 2' },
      ]);
    });

    test('is a no-op when the trimmed name is empty', () => {
      const meta = { tabs: [{ id: 'a', name: 'Tab 1' }], activeTabId: 'a' };

      expect(renameTab(meta, 'a', '   ')).toBe(meta);
    });
  });

  describe('copyTabContentToClipboard', () => {
    test('writes the content via navigator.clipboard.writeText', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      await copyTabContentToClipboard('openapi: 3.0.0\n');

      expect(writeText).toHaveBeenCalledWith('openapi: 3.0.0\n');
    });
  });
});
