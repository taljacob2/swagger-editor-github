import React, { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';

import SuggestPrMenuItemHandler from './SuggestPrMenuItemHandler.jsx';
import * as aggregationProvenanceService from '../../../../workspace-tabs/aggregation-provenance-service.js';
import * as workspaceTabsService from '../../../../workspace-tabs/workspace-tabs-service.js';

vi.mock('../../../../workspace-tabs/workspace-tabs-service.js');
// No tab in these tests has an AggregationProvenance record -- routing
// (covered by its own tests below) always falls through to SuggestPrModal.
vi.mock('../../../../workspace-tabs/aggregation-provenance-service.js', () => ({
  getAggregationProvenance: vi.fn(() => null),
}));

// SuggestPrModal's own flow (linking, drift, diff, PR creation) is covered by
// its own dedicated tests -- stubbed here down to just reporting which tab it
// was opened for, so this file can focus on this entry point's own job:
// resolving the active tab and opening the modal for it.
vi.mock('../../../../workspace-tabs/components/SuggestPrModal.jsx', () => ({
  default: ({ isOpen, tabId }) => (isOpen ? <div>Suggest PR modal open for {tabId}</div> : null),
}));
// Likewise for the aggregated-set counterpart -- its own routing condition
// is exercised in the "routes to the aggregated modal" tests below.
vi.mock('../../../../workspace-tabs/components/SuggestAggregatedPrsModal.jsx', () => ({
  default: ({ isOpen, tabId }) =>
    isOpen ? <div>Suggest aggregated PRs modal open for {tabId}</div> : null,
}));

const getComponent = () => null;
const editorActions = { convertContentToJSON: vi.fn(), convertContentToYAML: vi.fn() };

describe('SuggestPrMenuItemHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceTabsService.getWorkspaceMeta.mockReturnValue({
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
      <SuggestPrMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorActions={editorActions}
      />
    );

    expect(screen.queryByText(/Suggest PR modal open for/)).not.toBeInTheDocument();
  });

  test('openModal() opens the modal for the currently active tab', () => {
    const ref = createRef();
    render(
      <SuggestPrMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorActions={editorActions}
      />
    );

    act(() => ref.current.openModal());

    expect(screen.getByText('Suggest PR modal open for b')).toBeInTheDocument();
  });

  test('routes to the aggregated-set modal instead when the active tab has an AggregationProvenance record', () => {
    aggregationProvenanceService.getAggregationProvenance.mockReturnValue({ setName: 'My Set' });
    const ref = createRef();
    render(
      <SuggestPrMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorActions={editorActions}
      />
    );

    act(() => ref.current.openModal());

    expect(screen.getByText('Suggest aggregated PRs modal open for b')).toBeInTheDocument();
    expect(screen.queryByText(/^Suggest PR modal open for/)).not.toBeInTheDocument();
  });
});
