import React from 'react';
import { List } from 'immutable';
import { render, screen, fireEvent } from '@testing-library/react';

import OperationSummaryWrapper from './OperationSummaryWrapper.jsx';
import { ContentOrigin } from '../../../../editor-content-origin/root-injects.js';
import * as workspaceTabsService from '../../../../workspace-tabs/workspace-tabs-service.js';

vi.mock('../../../../workspace-tabs/workspace-tabs-service.js');

const Original = () => <div className="opblock-summary">Original row</div>;

const YAML_SPEC = [
  'openapi: 3.0.0',
  'paths:',
  '  /pet:',
  '    post: {}',
  '  /pet/findByStatus:',
  '    get: {}',
].join('\n');

const buildSystem = (overrides = {}) => ({
  editorSelectors: {
    selectContentIsReadOnly: vi.fn().mockReturnValue(false),
    selectContent: vi.fn().mockReturnValue(YAML_SPEC),
    selectIsContentFormatYAML: vi.fn().mockReturnValue(true),
    ...overrides.editorSelectors,
  },
  editorActions: {
    setContent: vi.fn(),
    ...overrides.editorActions,
  },
  editorPreviewSwaggerUIActions: {
    recordOperationRemovals: vi.fn(),
    ...overrides.editorPreviewSwaggerUIActions,
  },
  EditorContentOrigin: ContentOrigin,
});

const renderWrapped = (system, specPath = List(['paths', '/pet/findByStatus', 'get'])) => {
  const Wrapped = OperationSummaryWrapper(Original, system);
  render(<Wrapped specPath={specPath} />);
};

describe('OperationSummaryWrapper', () => {
  beforeEach(() => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'tab-1', name: 'Tab 1' }],
      activeTabId: 'tab-1',
    });
  });

  test('renders a checked checkbox alongside the original row', () => {
    renderWrapped(buildSystem());

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Original row')).toBeInTheDocument();
  });

  test('unchecking removes that operation from the editor content and records the removal', () => {
    const system = buildSystem();
    renderWrapped(system);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(system.editorActions.setContent).toHaveBeenCalledTimes(1);
    const [content, origin] = system.editorActions.setContent.mock.calls[0];
    expect(content).not.toContain('findByStatus');
    expect(content).toContain('/pet:');
    expect(origin).toBe(ContentOrigin.EndpointFilter);

    expect(system.editorPreviewSwaggerUIActions.recordOperationRemovals).toHaveBeenCalledWith({
      tabId: 'tab-1',
      records: [expect.objectContaining({ path: '/pet/findByStatus', method: 'get' })],
    });
  });

  test('does nothing when the current content cannot be parsed', () => {
    const system = buildSystem({
      editorSelectors: { selectContent: vi.fn().mockReturnValue('{ not: valid: yaml: [') },
    });
    renderWrapped(system);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(system.editorActions.setContent).not.toHaveBeenCalled();
  });

  test('skips the checkbox entirely for read-only content', () => {
    const system = buildSystem({
      editorSelectors: { selectContentIsReadOnly: vi.fn().mockReturnValue(true) },
    });
    renderWrapped(system);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Original row')).toBeInTheDocument();
  });
});
