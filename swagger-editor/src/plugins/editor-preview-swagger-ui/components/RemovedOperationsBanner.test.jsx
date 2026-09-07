import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import RemovedOperationsBanner from './RemovedOperationsBanner.jsx';
import * as workspaceTabsService from '../../workspace-tabs/workspace-tabs-service.js';

vi.mock('../../workspace-tabs/workspace-tabs-service.js');

const renderBanner = (overrides = {}) => {
  const editorPreviewSwaggerUISelectors = {
    selectRemovedOperations: vi.fn().mockReturnValue([]),
    ...overrides.editorPreviewSwaggerUISelectors,
  };
  const editorPreviewSwaggerUIActions = {
    restoreOperations: vi.fn(),
    ...overrides.editorPreviewSwaggerUIActions,
  };
  const result = render(
    <RemovedOperationsBanner
      editorPreviewSwaggerUISelectors={editorPreviewSwaggerUISelectors}
      editorPreviewSwaggerUIActions={editorPreviewSwaggerUIActions}
    />
  );
  return { ...result, editorPreviewSwaggerUISelectors, editorPreviewSwaggerUIActions };
};

describe('RemovedOperationsBanner', () => {
  beforeEach(() => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'tab-1', name: 'Tab 1' }],
      activeTabId: 'tab-1',
    });
    workspaceTabsService.onWorkspaceChanged.mockReturnValue(() => {});
  });

  test('renders nothing when the active tab has no removed operations', () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  test('lists each removed operation with a Restore button', () => {
    renderBanner({
      editorPreviewSwaggerUISelectors: {
        selectRemovedOperations: vi
          .fn()
          .mockReturnValue([{ path: '/pet/findByStatus', method: 'get', operation: {} }]),
      },
    });

    expect(screen.getByText('1 endpoint removed from this spec')).toBeInTheDocument();
    expect(screen.getByText('/pet/findByStatus')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
  });

  test('Restore dispatches restoreOperations for that one record', () => {
    const record = { path: '/pet/findByStatus', method: 'get', operation: {} };
    const { editorPreviewSwaggerUIActions } = renderBanner({
      editorPreviewSwaggerUISelectors: {
        selectRemovedOperations: vi.fn().mockReturnValue([record]),
      },
    });

    fireEvent.click(screen.getByText('Restore'));

    expect(editorPreviewSwaggerUIActions.restoreOperations).toHaveBeenCalledWith('tab-1', [record]);
  });
});
