import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import TabBar from './TabBar.jsx';
import * as workspaceTabsService from '../../workspace-tabs-service.js';

vi.mock('../../workspace-tabs-service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getWorkspaceMeta: vi.fn(),
    saveWorkspaceMeta: vi.fn(),
    getTabContent: vi.fn(),
    setTabContent: vi.fn(),
    removeTabContent: vi.fn(),
    copyTabContentToClipboard: vi.fn(),
  };
});

const EditorContentOrigin = { LocalStorage: 'local-storage' };

const threeTabMeta = () => ({
  tabs: [
    { id: 'a', name: 'Tab 1' },
    { id: 'b', name: 'Tab 2' },
    { id: 'c', name: 'Tab 3' },
  ],
  activeTabId: 'a',
});

const CONTENT_BY_ID = { a: 'a-content', b: 'b-content', c: 'c-content' };

describe('TabBar', () => {
  let editorActions;
  let contentStore;

  beforeEach(() => {
    editorActions = { setContent: vi.fn(), setActiveDocument: vi.fn(), disposeDocument: vi.fn() };
    contentStore = { ...CONTENT_BY_ID };
    workspaceTabsService.getWorkspaceMeta.mockReturnValue(threeTabMeta());
    // Backed by a shared store (not just a fixed lookup) so a duplicate's
    // setTabContent-then-getTabContent read-after-write behaves like real
    // localStorage, the same as the component relies on.
    workspaceTabsService.getTabContent.mockImplementation((id) => contentStore[id] || '');
    workspaceTabsService.setTabContent.mockImplementation((id, content) => {
      contentStore[id] = content;
    });
    workspaceTabsService.removeTabContent.mockImplementation((id) => {
      delete contentStore[id];
    });
    workspaceTabsService.copyTabContentToClipboard.mockResolvedValue(undefined);
  });

  test('renders every tab, highlighting the active one', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    expect(screen.getByText('Tab 1').closest('.swagger-editor__tab')).toHaveClass(
      'swagger-editor__tab--active'
    );
    expect(screen.getByText('Tab 2').closest('.swagger-editor__tab')).not.toHaveClass(
      'swagger-editor__tab--active'
    );
    expect(screen.getByText('Tab 3')).toBeInTheDocument();
  });

  test('clicking a tab switches the active tab and pushes its content into the editor', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getByText('Tab 2'));

    expect(workspaceTabsService.saveWorkspaceMeta).toHaveBeenCalledWith(
      expect.objectContaining({ activeTabId: 'b' })
    );
    expect(editorActions.setActiveDocument).toHaveBeenCalledWith('b');
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
    expect(screen.getByText('Tab 2').closest('.swagger-editor__tab')).toHaveClass(
      'swagger-editor__tab--active'
    );
  });

  test("switching tabs only touches the metadata blob, never any tab's stored content (regression: a stale full-content snapshot used to clobber other tabs' edits on switch)", () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getByText('Tab 2'));

    expect(workspaceTabsService.setTabContent).not.toHaveBeenCalled();
    expect(workspaceTabsService.removeTabContent).not.toHaveBeenCalled();
  });

  test('the "+" button adds a new blank tab and activates it', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getByTitle('New tab'));

    expect(screen.getByText('Tab 4')).toBeInTheDocument();
    expect(editorActions.setContent).toHaveBeenCalledWith('', 'local-storage');
  });

  test('duplicating a tab copies its content into the new tab and activates it', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    const duplicateButtons = screen.getAllByTitle('Duplicate tab');
    fireEvent.click(duplicateButtons[0]); // duplicate "Tab 1"

    expect(screen.getByText('Tab 1 copy')).toBeInTheDocument();
    expect(workspaceTabsService.setTabContent).toHaveBeenCalledWith(
      expect.any(String),
      'a-content'
    );
    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('closing a background tab removes its stored content but does not touch the editor', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    const closeButtons = screen.getAllByTitle('Close tab');
    fireEvent.click(closeButtons[1]); // close "Tab 2" (not active)

    expect(screen.queryByText('Tab 2')).not.toBeInTheDocument();
    expect(workspaceTabsService.removeTabContent).toHaveBeenCalledWith('b');
    expect(editorActions.disposeDocument).toHaveBeenCalledWith('b');
    expect(editorActions.setContent).not.toHaveBeenCalled();
  });

  test('closing the active tab activates the previous tab and pushes its content', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getAllByTitle('Close tab')[0]); // close "Tab 1" (active)

    expect(screen.queryByText('Tab 1')).not.toBeInTheDocument();
    expect(workspaceTabsService.removeTabContent).toHaveBeenCalledWith('a');
    expect(editorActions.disposeDocument).toHaveBeenCalledWith('a');
    expect(editorActions.setActiveDocument).toHaveBeenCalledWith('b');
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  test('the close button is hidden when only one tab remains', () => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'a', name: 'Tab 1' }],
      activeTabId: 'a',
    });

    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    expect(screen.queryByTitle('Close tab')).not.toBeInTheDocument();
  });

  test('copy button copies the tab content to the clipboard and shows feedback', async () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getAllByTitle('Copy tab content to clipboard')[0]);

    expect(workspaceTabsService.copyTabContentToClipboard).toHaveBeenCalledWith('a-content');
    await waitFor(() => {
      expect(screen.getAllByTitle('Copy tab content to clipboard')[0]).toHaveTextContent('✓');
    });
  });

  test('Alt+2 switches directly to the second tab', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: '2', altKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  test('Alt+9 is a no-op when there are fewer than 9 tabs', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: '9', altKey: true });

    expect(editorActions.setContent).not.toHaveBeenCalled();
  });

  test('Alt+` moves to the next tab, wrapping around from the last', () => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({ ...threeTabMeta(), activeTabId: 'c' });

    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: '`', altKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('Alt+~ (Alt+Shift+`) moves to the previous tab, wrapping around from the first', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: '~', altKey: true, shiftKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('c-content', 'local-storage');
  });

  test('double-clicking a tab name enters rename mode, and Enter commits the new name', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: 'My API' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('My API')).toBeInTheDocument();
    expect(workspaceTabsService.saveWorkspaceMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: expect.arrayContaining([expect.objectContaining({ id: 'a', name: 'My API' })]),
      })
    );
  });

  test('blurring the rename input commits the new name', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);

    expect(screen.getByText('Renamed')).toBeInTheDocument();
  });

  test('Escape cancels the rename without saving', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.getByText('Tab 1')).toBeInTheDocument();
    expect(screen.queryByText('Discarded')).not.toBeInTheDocument();
    expect(workspaceTabsService.saveWorkspaceMeta).not.toHaveBeenCalled();
  });

  test('an empty (or whitespace-only) name is a no-op, leaving the original name in place', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Tab 1')).toBeInTheDocument();
  });

  test('switching and closing tabs does not throw when setActiveDocument/disposeDocument are absent (textarea preset has no editor-monaco)', () => {
    editorActions = { setContent: vi.fn() };
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    expect(() => fireEvent.click(screen.getByText('Tab 2'))).not.toThrow();
    expect(() => fireEvent.click(screen.getAllByTitle('Close tab')[0])).not.toThrow();
  });

  test('digit keys without Alt are ignored', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: '2', altKey: false });

    expect(editorActions.setContent).not.toHaveBeenCalled();
  });
});
