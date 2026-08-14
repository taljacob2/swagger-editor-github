import {
  addTab,
  closeTab,
  copyTabContentToClipboard,
  duplicateTab,
  getActiveTab,
  getWorkspace,
  saveWorkspace,
  setActiveTab,
  updateTabContent,
} from './workspace-tabs-service.js';

describe('workspace-tabs-service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getWorkspace', () => {
    test('migrates a pre-existing legacy single-content key into "Tab 1"', () => {
      localStorage.setItem('swagger-editor-content', 'openapi: 3.0.0\n');

      const workspace = getWorkspace();

      expect(workspace.tabs).toHaveLength(1);
      expect(workspace.tabs[0]).toMatchObject({ name: 'Tab 1', content: 'openapi: 3.0.0\n' });
      expect(workspace.activeTabId).toBe(workspace.tabs[0].id);
      expect(localStorage.getItem('swagger-editor-content')).toBeNull();
      expect(JSON.parse(localStorage.getItem('workspace-tabs')).tabs).toHaveLength(1);
    });

    test('builds a fresh empty "Tab 1" when nothing is stored at all', () => {
      const workspace = getWorkspace();

      expect(workspace.tabs).toEqual([{ id: expect.any(String), name: 'Tab 1', content: '' }]);
      expect(workspace.activeTabId).toBe(workspace.tabs[0].id);
    });

    test('falls back to a fresh default when stored JSON is corrupt', () => {
      localStorage.setItem('workspace-tabs', 'not json');

      const workspace = getWorkspace();

      expect(workspace.tabs).toHaveLength(1);
      expect(workspace.tabs[0].name).toBe('Tab 1');
    });

    test('returns a previously saved workspace unchanged', () => {
      const saved = { tabs: [{ id: 'a', name: 'Tab 1', content: 'x' }], activeTabId: 'a' };
      saveWorkspace(saved);

      expect(getWorkspace()).toEqual(saved);
    });
  });

  describe('getActiveTab', () => {
    test('returns the tab matching activeTabId', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: '' },
          { id: 'b', name: 'Tab 2', content: '' },
        ],
        activeTabId: 'b',
      };

      expect(getActiveTab(workspace)).toEqual({ id: 'b', name: 'Tab 2', content: '' });
    });

    test('falls back to the first tab when activeTabId matches nothing', () => {
      const workspace = { tabs: [{ id: 'a', name: 'Tab 1', content: '' }], activeTabId: 'missing' };

      expect(getActiveTab(workspace)).toEqual({ id: 'a', name: 'Tab 1', content: '' });
    });
  });

  describe('addTab', () => {
    test('appends a new sequentially-named tab and makes it active', () => {
      const workspace = { tabs: [{ id: 'a', name: 'Tab 1', content: '' }], activeTabId: 'a' };

      const next = addTab(workspace);

      expect(next.tabs).toHaveLength(2);
      expect(next.tabs[1]).toMatchObject({ name: 'Tab 2', content: '' });
      expect(next.activeTabId).toBe(next.tabs[1].id);
    });
  });

  describe('duplicateTab', () => {
    test('inserts a copy right after the source tab, with its content, and activates it', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: 'hello' },
          { id: 'b', name: 'Tab 2', content: '' },
        ],
        activeTabId: 'a',
      };

      const next = duplicateTab(workspace, 'a');

      expect(next.tabs.map((tab) => tab.name)).toEqual(['Tab 1', 'Tab 1 copy', 'Tab 2']);
      expect(next.tabs[1].content).toBe('hello');
      expect(next.activeTabId).toBe(next.tabs[1].id);
    });

    test('is a no-op when the tab id does not exist', () => {
      const workspace = { tabs: [{ id: 'a', name: 'Tab 1', content: '' }], activeTabId: 'a' };

      expect(duplicateTab(workspace, 'missing')).toBe(workspace);
    });
  });

  describe('closeTab', () => {
    test('refuses to close the last remaining tab', () => {
      const workspace = { tabs: [{ id: 'a', name: 'Tab 1', content: '' }], activeTabId: 'a' };

      expect(closeTab(workspace, 'a')).toBe(workspace);
    });

    test('removes a non-active tab without changing activeTabId', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: '' },
          { id: 'b', name: 'Tab 2', content: '' },
        ],
        activeTabId: 'a',
      };

      const next = closeTab(workspace, 'b');

      expect(next.tabs.map((tab) => tab.id)).toEqual(['a']);
      expect(next.activeTabId).toBe('a');
    });

    test('closing the active tab activates the previous tab in the list', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: '' },
          { id: 'b', name: 'Tab 2', content: '' },
          { id: 'c', name: 'Tab 3', content: '' },
        ],
        activeTabId: 'b',
      };

      const next = closeTab(workspace, 'b');

      expect(next.tabs.map((tab) => tab.id)).toEqual(['a', 'c']);
      expect(next.activeTabId).toBe('a');
    });

    test('closing the first (active) tab activates the new first tab', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: '' },
          { id: 'b', name: 'Tab 2', content: '' },
        ],
        activeTabId: 'a',
      };

      const next = closeTab(workspace, 'a');

      expect(next.tabs.map((tab) => tab.id)).toEqual(['b']);
      expect(next.activeTabId).toBe('b');
    });
  });

  describe('setActiveTab', () => {
    test('updates activeTabId when the tab exists', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: '' },
          { id: 'b', name: 'Tab 2', content: '' },
        ],
        activeTabId: 'a',
      };

      expect(setActiveTab(workspace, 'b').activeTabId).toBe('b');
    });

    test('is a no-op when the tab id does not exist', () => {
      const workspace = { tabs: [{ id: 'a', name: 'Tab 1', content: '' }], activeTabId: 'a' };

      expect(setActiveTab(workspace, 'missing')).toBe(workspace);
    });
  });

  describe('updateTabContent', () => {
    test('replaces only the matching tab’s content', () => {
      const workspace = {
        tabs: [
          { id: 'a', name: 'Tab 1', content: 'old' },
          { id: 'b', name: 'Tab 2', content: 'untouched' },
        ],
        activeTabId: 'a',
      };

      const next = updateTabContent(workspace, 'a', 'new');

      expect(next.tabs).toEqual([
        { id: 'a', name: 'Tab 1', content: 'new' },
        { id: 'b', name: 'Tab 2', content: 'untouched' },
      ]);
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
