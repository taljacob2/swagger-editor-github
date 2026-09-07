import React from 'react';
import { List, Map } from 'immutable';
import { render, screen, fireEvent } from '@testing-library/react';

import OperationTagWrapper from './OperationTagWrapper.jsx';
import { ContentOrigin } from '../../../../editor-content-origin/root-injects.js';
import * as workspaceTabsService from '../../../../workspace-tabs/workspace-tabs-service.js';

vi.mock('../../../../workspace-tabs/workspace-tabs-service.js');

const Original = () => <div className="opblock-tag">pet</div>;

const YAML_SPEC = [
  'openapi: 3.0.0',
  'paths:',
  '  /pet:',
  '    post:',
  '      tags: [pet]',
  '  /pet/findByStatus:',
  '    get:',
  '      tags: [pet]',
].join('\n');

const buildTagObj = (operations) =>
  Map({
    operations: List(operations.map(({ path, method }) => Map({ path, method }))),
  });

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
    restoreOperations: vi.fn(),
    ...overrides.editorPreviewSwaggerUIActions,
  },
  editorPreviewSwaggerUISelectors: {
    selectRemovedOperations: vi.fn().mockReturnValue([]),
    ...overrides.editorPreviewSwaggerUISelectors,
  },
  EditorContentOrigin: ContentOrigin,
});

const renderWrapped = (
  system,
  tag = 'pet',
  operations = [
    { path: '/pet', method: 'post' },
    { path: '/pet/findByStatus', method: 'get' },
  ]
) => {
  const Wrapped = OperationTagWrapper(Original, system);
  render(<Wrapped tag={tag} tagObj={buildTagObj(operations)} />);
};

describe('OperationTagWrapper', () => {
  beforeEach(() => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'tab-1', name: 'Tab 1' }],
      activeTabId: 'tab-1',
    });
  });

  test('renders the original tag header plus a "Remove all" action', () => {
    renderWrapped(buildSystem());

    expect(screen.getByText('pet')).toBeInTheDocument();
    expect(screen.getByText('Remove all')).toBeInTheDocument();
  });

  test('"Remove all" removes every operation under the tag in one content rewrite', () => {
    const system = buildSystem();
    renderWrapped(system);

    fireEvent.click(screen.getByText('Remove all'));

    expect(system.editorActions.setContent).toHaveBeenCalledTimes(1);
    const [content, origin] = system.editorActions.setContent.mock.calls[0];
    expect(content).not.toContain('paths');
    expect(origin).toBe(ContentOrigin.EndpointFilter);

    expect(system.editorPreviewSwaggerUIActions.recordOperationRemovals).toHaveBeenCalledWith({
      tabId: 'tab-1',
      records: [
        expect.objectContaining({ path: '/pet', method: 'post' }),
        expect.objectContaining({ path: '/pet/findByStatus', method: 'get' }),
      ],
    });
  });

  test('shows "Restore all" with a count when history has entries for this tag', () => {
    const system = buildSystem({
      editorPreviewSwaggerUISelectors: {
        selectRemovedOperations: vi.fn().mockReturnValue([
          { path: '/pet/findByStatus', method: 'get', operation: { tags: ['pet'] } },
          { path: '/store/order', method: 'post', operation: { tags: ['store'] } },
        ]),
      },
    });
    renderWrapped(system);

    expect(screen.getByText('Restore all (1)')).toBeInTheDocument();
  });

  test('"Restore all" restores only this tag\'s removed records', () => {
    const petRecord = { path: '/pet/findByStatus', method: 'get', operation: { tags: ['pet'] } };
    const system = buildSystem({
      editorPreviewSwaggerUISelectors: {
        selectRemovedOperations: vi
          .fn()
          .mockReturnValue([
            petRecord,
            { path: '/store/order', method: 'post', operation: { tags: ['store'] } },
          ]),
      },
    });
    renderWrapped(system);

    fireEvent.click(screen.getByText('Restore all (1)'));

    expect(system.editorPreviewSwaggerUIActions.restoreOperations).toHaveBeenCalledWith('tab-1', [
      petRecord,
    ]);
  });

  test('hides both actions for read-only content', () => {
    const system = buildSystem({
      editorSelectors: { selectContentIsReadOnly: vi.fn().mockReturnValue(true) },
    });
    renderWrapped(system);

    expect(screen.queryByText('Remove all')).not.toBeInTheDocument();
    expect(screen.getByText('pet')).toBeInTheDocument();
  });
});
