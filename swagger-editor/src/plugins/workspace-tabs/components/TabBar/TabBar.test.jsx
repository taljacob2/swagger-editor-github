import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';

import TabBar from './TabBar.jsx';
import * as workspaceTabsService from '../../workspace-tabs-service.js';
import * as linkedTargetService from '../../linked-target-service.js';
import * as aggregationProvenanceService from '../../aggregation-provenance-service.js';

vi.mock('../../workspace-tabs-service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getWorkspaceMeta: vi.fn(),
    saveWorkspaceMeta: vi.fn(),
    getTabContent: vi.fn(),
    setTabContent: vi.fn(),
    removeTabContent: vi.fn(),
  };
});

vi.mock('../../linked-target-service.js', () => ({
  removeLinkedTarget: vi.fn(),
  getLinkedTarget: vi.fn(() => null),
  setLinkedTarget: vi.fn(),
}));

// No tab in these tests has an AggregationProvenance record unless a test
// says otherwise -- routing (covered by its own test below) always falls
// through to SuggestPrModal by default.
vi.mock('../../aggregation-provenance-service.js', () => ({
  getAggregationProvenance: vi.fn(() => null),
  setAggregationProvenance: vi.fn(),
}));

// SuggestPrModal's own flow (fetch-fresh, drift, diff, PR creation, and the
// linking phase it now handles internally) is covered by its own dedicated
// tests -- stubbed here down to just reporting which tab it was opened for,
// so this file can focus on the tab bar wiring (which tab id gets passed,
// open/close) without re-driving the whole linking/suggest flow.
vi.mock('../SuggestPrModal.jsx', () => ({
  default: ({ isOpen, tabId }) => (isOpen ? <div>Suggest PR modal open for {tabId}</div> : null),
}));
// Likewise for the aggregated-set counterpart -- its own routing condition
// is exercised in the "routes to the aggregated modal" test below.
vi.mock('../SuggestAggregatedPrsModal.jsx', () => ({
  default: ({ isOpen, tabId }) =>
    isOpen ? <div>Suggest aggregated PRs modal open for {tabId}</div> : null,
}));

const getComponent = vi.fn();

// jsdom doesn't implement ResizeObserver -- same mock pattern as
// useOverflowCompact.test.jsx, which needs it for the same reason (the
// component observes an element's size to react to content/layout changes
// a plain 'resize' listener wouldn't catch).
class MockResizeObserver {
  // eslint-disable-next-line class-methods-use-this
  observe() {}

  // eslint-disable-next-line class-methods-use-this
  disconnect() {}
}

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
  const originalResizeObserver = window.ResizeObserver;

  beforeEach(() => {
    window.ResizeObserver = MockResizeObserver;
    // jsdom doesn't implement scrollIntoView either.
    Element.prototype.scrollIntoView = vi.fn();
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
  });

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver;
  });

  test('renders every tab, highlighting the active one', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    expect(screen.getByText('Tab 1').closest('.swagger-editor__tab')).toHaveClass(
      'swagger-editor__tab--active'
    );
    expect(screen.getByText('Tab 2').closest('.swagger-editor__tab')).not.toHaveClass(
      'swagger-editor__tab--active'
    );
    expect(screen.getByText('Tab 3')).toBeInTheDocument();
  });

  test('clicking a tab switches the active tab and pushes its content into the editor', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

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
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.click(screen.getByText('Tab 2'));

    expect(workspaceTabsService.setTabContent).not.toHaveBeenCalled();
    expect(workspaceTabsService.removeTabContent).not.toHaveBeenCalled();
  });

  test('switching tabs flushes a pending debounced content write before activating the next tab (regression: a stale keystroke from the outgoing tab used to land on the new tab after the switch)', () => {
    const flushPendingEditorContent = vi.fn();
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
        flushPendingEditorContent={flushPendingEditorContent}
      />
    );

    fireEvent.click(screen.getByText('Tab 2'));

    expect(flushPendingEditorContent).toHaveBeenCalledTimes(1);
    // Order matters: flushing has to happen while "Tab 1" is still the
    // active tab, i.e. strictly before the new tab's content is pushed in --
    // otherwise the flush's own setContent call (carrying Tab 1's content)
    // would be mistaken for Tab 2's and overwrite it.
    expect(flushPendingEditorContent.mock.invocationCallOrder[0]).toBeLessThan(
      editorActions.setContent.mock.invocationCallOrder[0]
    );
  });

  test('is unaffected when no flushPendingEditorContent prop is supplied', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    expect(() => fireEvent.click(screen.getByText('Tab 2'))).not.toThrow();
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  test('the "+" button adds a new blank tab and activates it', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.click(screen.getByTitle('New tab'));

    expect(screen.getByText('Tab 4')).toBeInTheDocument();
    expect(editorActions.setContent).toHaveBeenCalledWith('', 'local-storage');
  });

  test('duplicating a tab copies its content into the new tab and activates it', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    const duplicateButtons = screen.getAllByTitle('Duplicate tab');
    fireEvent.click(duplicateButtons[0]); // duplicate "Tab 1"

    expect(screen.getByText('Tab 1 copy')).toBeInTheDocument();
    expect(workspaceTabsService.setTabContent).toHaveBeenCalledWith(
      expect.any(String),
      'a-content'
    );
    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('duplicating a linked tab carries the link over to the new tab', () => {
    const target = { owner: 'octo-org', repo: 'petstore', path: 'openapi.yaml' };
    linkedTargetService.getLinkedTarget.mockImplementation((tabId) =>
      tabId === 'a' ? target : null
    );

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    const duplicateButtons = screen.getAllByTitle('Duplicate tab');
    fireEvent.click(duplicateButtons[0]); // duplicate "Tab 1", which is linked

    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(expect.any(String), target);
  });

  test('duplicating an unlinked tab does not invent a link for the new tab', () => {
    linkedTargetService.getLinkedTarget.mockReturnValue(null);

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    const duplicateButtons = screen.getAllByTitle('Duplicate tab');
    fireEvent.click(duplicateButtons[0]);

    expect(linkedTargetService.setLinkedTarget).not.toHaveBeenCalled();
  });

  test('duplicating an aggregated tab carries its provenance record over to the new tab', () => {
    const provenance = { setId: 'set-1', setName: 'My Set', sources: [] };
    aggregationProvenanceService.getAggregationProvenance.mockImplementation((tabId) =>
      tabId === 'a' ? provenance : null
    );

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    const duplicateButtons = screen.getAllByTitle('Duplicate tab');
    fireEvent.click(duplicateButtons[0]); // duplicate "Tab 1", which is aggregated

    expect(aggregationProvenanceService.setAggregationProvenance).toHaveBeenCalledWith(
      expect.any(String),
      provenance
    );
    // An aggregated tab's "link" is its provenance record, not a plain
    // single-file link -- carrying over both would leave the copy pointed
    // at whichever one SuggestAggregatedPrsModal/SuggestPrModal's routing
    // happens to check first, instead of staying an aggregated tab.
    expect(linkedTargetService.setLinkedTarget).not.toHaveBeenCalled();
  });

  test('closing a background tab removes its stored content but does not touch the editor', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    const closeButtons = screen.getAllByTitle('Close tab');
    fireEvent.click(closeButtons[1]); // close "Tab 2" (not active)

    expect(screen.queryByText('Tab 2')).not.toBeInTheDocument();
    expect(workspaceTabsService.removeTabContent).toHaveBeenCalledWith('b');
    expect(linkedTargetService.removeLinkedTarget).toHaveBeenCalledWith('b');
    expect(editorActions.disposeDocument).toHaveBeenCalledWith('b');
    expect(editorActions.setContent).not.toHaveBeenCalled();
  });

  test('closing the active tab activates the previous tab and pushes its content', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.click(screen.getAllByTitle('Close tab')[0]); // close "Tab 1" (active)

    expect(screen.queryByText('Tab 1')).not.toBeInTheDocument();
    expect(workspaceTabsService.removeTabContent).toHaveBeenCalledWith('a');
    expect(editorActions.disposeDocument).toHaveBeenCalledWith('a');
    expect(editorActions.setActiveDocument).toHaveBeenCalledWith('b');
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  // Linking has no button of its own -- it's only ever reached on the way to
  // suggesting a PR (below), either because the tab isn't linked yet or via
  // SuggestPrModal's own "Change link" affordance (also below).
  test('the single tab action reflects whether the tab is linked yet', () => {
    linkedTargetService.getLinkedTarget.mockImplementation((tabId) =>
      tabId === 'a' ? { owner: 'octo-org', repo: 'petstore' } : null
    );

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    expect(screen.getByTitle('Suggest pull request to octo-org/petstore')).toBeInTheDocument();
    expect(screen.getAllByTitle('Link to a repository file & suggest a pull request')).toHaveLength(
      2
    );
  });

  test('Suggest PR opens SuggestPrModal for the clicked tab, linked or not', () => {
    linkedTargetService.getLinkedTarget.mockImplementation((tabId) =>
      tabId === 'b' ? { owner: 'octo-org', repo: 'petstore' } : null
    );

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );
    fireEvent.click(screen.getAllByTitle('Suggest pull request to octo-org/petstore')[0]); // Tab 2

    expect(screen.getByText('Suggest PR modal open for b')).toBeInTheDocument();
  });

  test('Suggest PR routes to the aggregated-set modal when the tab has an AggregationProvenance record', () => {
    aggregationProvenanceService.getAggregationProvenance.mockImplementation((tabId) =>
      tabId === 'b' ? { setName: 'My Set' } : null
    );

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );
    fireEvent.click(screen.getByTitle('Suggest pull requests from the aggregated set "My Set"'));

    expect(screen.getByText('Suggest aggregated PRs modal open for b')).toBeInTheDocument();
    expect(screen.queryByText(/^Suggest PR modal open for/)).not.toBeInTheDocument();
  });

  test('Suggest PR on an unlinked tab also opens SuggestPrModal, which handles linking as its own phase', () => {
    linkedTargetService.getLinkedTarget.mockReturnValue(null);

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );
    fireEvent.click(screen.getAllByTitle('Link to a repository file & suggest a pull request')[1]); // Tab 2

    expect(screen.getByText('Suggest PR modal open for b')).toBeInTheDocument();
  });

  test('the close button is hidden when only one tab remains', () => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'a', name: 'Tab 1' }],
      activeTabId: 'a',
    });

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    expect(screen.queryByTitle('Close tab')).not.toBeInTheDocument();
  });

  test('Alt+2 switches directly to the second tab', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: '2', altKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  test('Alt+9 is a no-op when there are fewer than 9 tabs', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: '9', altKey: true });

    expect(editorActions.setContent).not.toHaveBeenCalled();
  });

  test('Alt+` moves to the next tab, wrapping around from the last', () => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({ ...threeTabMeta(), activeTabId: 'c' });

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: '`', altKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('Alt+~ (Alt+Shift+`) moves to the previous tab, wrapping around from the first', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: '~', altKey: true, shiftKey: true });

    expect(editorActions.setContent).toHaveBeenCalledWith('c-content', 'local-storage');
  });

  test('Alt+T adds a new blank tab and activates it', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: 't', altKey: true });

    expect(screen.getByText('Tab 4')).toBeInTheDocument();
    expect(editorActions.setContent).toHaveBeenCalledWith('', 'local-storage');
  });

  test('Alt+Q closes the active tab and activates the previous tab', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: 'q', altKey: true });

    expect(screen.queryByText('Tab 1')).not.toBeInTheDocument();
    expect(workspaceTabsService.removeTabContent).toHaveBeenCalledWith('a');
    expect(editorActions.disposeDocument).toHaveBeenCalledWith('a');
    expect(editorActions.setContent).toHaveBeenCalledWith('b-content', 'local-storage');
  });

  test('Alt+Q is a no-op when only one tab remains', () => {
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
      tabs: [{ id: 'a', name: 'Tab 1' }],
      activeTabId: 'a',
    });

    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: 'q', altKey: true });

    expect(workspaceTabsService.removeTabContent).not.toHaveBeenCalled();
  });

  test('Alt+S duplicates the active tab and activates the copy', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: 's', altKey: true });

    expect(screen.getByText('Tab 1 copy')).toBeInTheDocument();
    expect(workspaceTabsService.setTabContent).toHaveBeenCalledWith(
      expect.any(String),
      'a-content'
    );
    expect(editorActions.setContent).toHaveBeenCalledWith('a-content', 'local-storage');
  });

  test('Alt+X enters rename mode for the active tab', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: 'x', altKey: true });

    expect(screen.getByDisplayValue('Tab 1')).toBeInTheDocument();
  });

  test('double-clicking a tab name enters rename mode, and Enter commits the new name', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

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
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);

    expect(screen.getByText('Renamed')).toBeInTheDocument();
  });

  test('Escape cancels the rename without saving', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.getByText('Tab 1')).toBeInTheDocument();
    expect(screen.queryByText('Discarded')).not.toBeInTheDocument();
    expect(workspaceTabsService.saveWorkspaceMeta).not.toHaveBeenCalled();
  });

  test('an empty (or whitespace-only) name is a no-op, leaving the original name in place', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.doubleClick(screen.getByText('Tab 1'));
    const input = screen.getByDisplayValue('Tab 1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Tab 1')).toBeInTheDocument();
  });

  test('switching and closing tabs does not throw when setActiveDocument/disposeDocument are absent (textarea preset has no editor-monaco)', () => {
    editorActions = { setContent: vi.fn() };
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    expect(() => fireEvent.click(screen.getByText('Tab 2'))).not.toThrow();
    expect(() => fireEvent.click(screen.getAllByTitle('Close tab')[0])).not.toThrow();
  });

  test('digit keys without Alt are ignored', () => {
    render(
      <TabBar
        getComponent={getComponent}
        editorActions={editorActions}
        EditorContentOrigin={EditorContentOrigin}
      />
    );

    fireEvent.keyDown(window, { key: '2', altKey: false });

    expect(editorActions.setContent).not.toHaveBeenCalled();
  });

  describe('drag-and-drop reordering', () => {
    const dataTransfer = () => ({ setData: vi.fn() });

    // testing-library's fireEvent.dragOver/drop can't carry `clientX` through
    // in jsdom: jsdom has no DragEvent constructor
    // (https://github.com/jsdom/jsdom/issues/2913), so createEvent() falls
    // back to a plain Event, whose init dict silently ignores MouseEvent-only
    // fields like clientX. Building the event via createEvent and setting
    // clientX on it directly (a plain own-property assignment, since plain
    // Event doesn't declare it at all) works around that gap.
    const fireDragOver = (element, clientX) => {
      const event = createEvent.dragOver(element, { dataTransfer: dataTransfer() });
      event.clientX = clientX;
      fireEvent(element, event);
    };

    const fireDrop = (element, clientX) => {
      const event = createEvent.drop(element, { dataTransfer: dataTransfer() });
      event.clientX = clientX;
      fireEvent(element, event);
    };

    test('dropping before a target tab moves the dragged tab in front of it', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );
      const source = screen.getByText('Tab 1').closest('.swagger-editor__tab');
      const target = screen.getByText('Tab 3').closest('.swagger-editor__tab');

      fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
      fireDragOver(target, 0);
      fireDrop(target, 0);

      expect(workspaceTabsService.saveWorkspaceMeta).toHaveBeenCalledWith({
        tabs: [
          { id: 'b', name: 'Tab 2' },
          { id: 'a', name: 'Tab 1' },
          { id: 'c', name: 'Tab 3' },
        ],
        activeTabId: 'a',
      });
    });

    test('dropping after a target tab moves the dragged tab behind it', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );
      const source = screen.getByText('Tab 1').closest('.swagger-editor__tab');
      const target = screen.getByText('Tab 3').closest('.swagger-editor__tab');

      fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
      fireDragOver(target, 100);
      fireDrop(target, 100);

      expect(workspaceTabsService.saveWorkspaceMeta).toHaveBeenCalledWith({
        tabs: [
          { id: 'b', name: 'Tab 2' },
          { id: 'c', name: 'Tab 3' },
          { id: 'a', name: 'Tab 1' },
        ],
        activeTabId: 'a',
      });
    });

    test('reordering never activates a different tab or reloads editor content', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );
      const source = screen.getByText('Tab 1').closest('.swagger-editor__tab');
      const target = screen.getByText('Tab 3').closest('.swagger-editor__tab');

      fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
      fireDragOver(target, 0);
      fireDrop(target, 0);

      expect(editorActions.setContent).not.toHaveBeenCalled();
      expect(editorActions.setActiveDocument).not.toHaveBeenCalled();
    });

    test('dropping a tab onto itself is a no-op', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );
      const source = screen.getByText('Tab 1').closest('.swagger-editor__tab');

      fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
      fireDrop(source, 0);

      expect(workspaceTabsService.saveWorkspaceMeta).not.toHaveBeenCalled();
    });

    test('shows a drop indicator on the side of the target tab being hovered', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );
      const source = screen.getByText('Tab 1').closest('.swagger-editor__tab');
      const target = screen.getByText('Tab 3').closest('.swagger-editor__tab');

      fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
      fireDragOver(target, 100);

      expect(target).toHaveClass('swagger-editor__tab--drag-over-after');
    });

    test('dragging ends without dropping clears the indicator', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );
      const source = screen.getByText('Tab 1').closest('.swagger-editor__tab');
      const target = screen.getByText('Tab 3').closest('.swagger-editor__tab');

      fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
      fireDragOver(target, 100);
      fireEvent.dragEnd(source);

      expect(target).not.toHaveClass('swagger-editor__tab--drag-over-after');
    });

    test('a tab being renamed is not draggable, so a stray drag cannot clobber the edit', () => {
      render(
        <TabBar
          getComponent={getComponent}
          editorActions={editorActions}
          EditorContentOrigin={EditorContentOrigin}
        />
      );

      fireEvent.doubleClick(screen.getByText('Tab 1'));
      const input = screen.getByDisplayValue('Tab 1');

      expect(input.closest('.swagger-editor__tab')).toHaveAttribute('draggable', 'false');
    });
  });
});
