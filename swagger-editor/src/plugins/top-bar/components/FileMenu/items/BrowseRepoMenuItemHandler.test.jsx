import React, { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import BrowseRepoMenuItemHandler from './BrowseRepoMenuItemHandler.jsx';
import * as workspaceTabsService from '../../../../workspace-tabs/workspace-tabs-service.js';
import * as linkedTargetService from '../../../../workspace-tabs/linked-target-service.js';

vi.mock('../../../../workspace-tabs/workspace-tabs-service.js');
vi.mock('../../../../workspace-tabs/linked-target-service.js');

vi.mock('../../../../github-repo-browser/components/RepoBrowserModal.jsx', () => ({
  default: ({ isOpen, onFileSelected }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() =>
          onFileSelected({
            owner: 'owner',
            repo: 'repo',
            path: 'openapi.yaml',
            ref: 'main',
            apiBaseUrl: 'https://api.github.com',
            content: 'openapi: 3.0.0\n',
          })
        }
      >
        Pick file
      </button>
    ) : null,
}));

const StubModal = () => null;

const getComponent = (name) => (name === 'Modal' ? StubModal : StubModal);

const editorActions = { setContent: vi.fn(), setActiveDocument: vi.fn() };
const EditorContentOrigin = { ImportUrl: 'import-url' };

describe('BrowseRepoMenuItemHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'a', name: 'Tab 1' }],
      activeTabId: 'a',
    });
    workspaceTabsService.addTab.mockReturnValue({
      tabs: [
        { id: 'a', name: 'Tab 1' },
        { id: 'b', name: 'Tab 2' },
      ],
      activeTabId: 'b',
    });
  });

  test('is closed until openModal() is called via ref', () => {
    const ref = createRef();
    render(
      <BrowseRepoMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    expect(screen.queryByText('Pick file')).not.toBeInTheDocument();
  });

  test('selecting a file creates a new tab, links it, and loads the content into the editor', async () => {
    const ref = createRef();
    render(
      <BrowseRepoMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    act(() => ref.current.openModal());
    await act(async () => {
      fireEvent.click(screen.getByText('Pick file'));
    });

    expect(workspaceTabsService.addTab).toHaveBeenCalledWith({
      tabs: [{ id: 'a', name: 'Tab 1' }],
      activeTabId: 'a',
    });
    expect(workspaceTabsService.saveWorkspaceMeta).toHaveBeenCalledWith({
      tabs: [
        { id: 'a', name: 'Tab 1' },
        { id: 'b', name: 'Tab 2' },
      ],
      activeTabId: 'b',
    });
    expect(workspaceTabsService.setTabContent).toHaveBeenCalledWith('b', 'openapi: 3.0.0\n');
    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({
        apiBaseUrl: 'https://api.github.com',
        owner: 'owner',
        repo: 'repo',
        path: 'openapi.yaml',
        ref: 'main',
        baselineContent: 'openapi: 3.0.0\n',
      })
    );
    expect(workspaceTabsService.notifyWorkspaceChanged).toHaveBeenCalled();
    expect(editorActions.setActiveDocument).toHaveBeenCalledWith('b');
    expect(editorActions.setContent).toHaveBeenCalledWith('openapi: 3.0.0\n', 'import-url');
  });
});
