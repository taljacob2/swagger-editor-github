import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import TabBar from './TabBar.jsx';
import * as workspaceTabsService from '../../workspace-tabs-service.js';

vi.mock('../../workspace-tabs-service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    copyTabContentToClipboard: vi.fn(),
  };
});

const EditorContentOrigin = { LocalStorage: 'local-storage' };

const threeTabWorkspace = () => ({
  tabs: [
    { id: 'a', name: 'Tab 1', content: 'a-content' },
    { id: 'b', name: 'Tab 2', content: 'b-content' },
    { id: 'c', name: 'Tab 3', content: 'c-content' },
  ],
  activeTabId: 'a',
});

describe('TabBar', () => {
  let editorActions;

  beforeEach(() => {
    editorActions = { setContent: vi.fn() };
    workspaceTabsService.getWorkspace.mockReturnValue(threeTabWorkspace());
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

    expect(workspaceTabsService.saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ activeTabId: 'b' })
    );
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
    expect(screen.getByText('Tab 2').closest('.swagger-editor__tab')).toHaveClass(
      'swagger-editor__tab--active'
    );
  });

  test('the "+" button adds a new blank tab and activates it', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getByTitle('New tab'));

    expect(screen.getByText('Tab 4')).toBeInTheDocument();
    expect(editorActions.setContent).toHaveBeenCalledWith('', 'local-storage');
  });

  test('duplicating a tab copies its content and activates the copy', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    const duplicateButtons = screen.getAllByTitle('Duplicate tab');
    fireEvent.click(duplicateButtons[0]); // duplicate "Tab 1"

    expect(screen.getByText('Tab 1 copy')).toBeInTheDocument();
    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('closing a background tab does not touch the editor content', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    const closeButtons = screen.getAllByTitle('Close tab');
    fireEvent.click(closeButtons[1]); // close "Tab 2" (not active)

    expect(screen.queryByText('Tab 2')).not.toBeInTheDocument();
    expect(editorActions.setContent).not.toHaveBeenCalled();
  });

  test('closing the active tab activates the previous tab and pushes its content', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.click(screen.getAllByTitle('Close tab')[0]); // close "Tab 1" (active)

    expect(screen.queryByText('Tab 1')).not.toBeInTheDocument();
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  test('the close button is hidden when only one tab remains', () => {
    workspaceTabsService.getWorkspace.mockReturnValue({
      tabs: [{ id: 'a', name: 'Tab 1', content: '' }],
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

  test('Alt+PageDown moves to the next tab, wrapping around from the last', () => {
    workspaceTabsService.getWorkspace.mockReturnValue({ ...threeTabWorkspace(), activeTabId: 'c' });

    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: 'PageDown', altKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('Alt+PageUp moves to the previous tab, wrapping around from the first', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: 'PageUp', altKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('c-content', 'local-storage');
  });

  test('double-clicking a tab name enters rename mode, and Enter commits the new name', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: 'My API' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('My API')).toBeInTheDocument();
    expect(workspaceTabsService.saveWorkspace).toHaveBeenCalledWith(
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
    expect(workspaceTabsService.saveWorkspace).not.toHaveBeenCalled();
  });

  test('an empty (or whitespace-only) name is a no-op, leaving the original name in place', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Tab 1')).toBeInTheDocument();
  });

  test('digit keys without Alt are ignored', () => {
    render(<TabBar editorActions={editorActions} EditorContentOrigin={EditorContentOrigin} />);

    fireEvent.keyDown(window, { key: '2', altKey: false });

    expect(editorActions.setContent).not.toHaveBeenCalled();
  });
});
