import React, { useState, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';

import { getAggregationProvenance } from '../../../../workspace-tabs/aggregation-provenance-service.js';
import SuggestAggregatedPrsModal from '../../../../workspace-tabs/components/SuggestAggregatedPrsModal.jsx';
import SuggestPrModal from '../../../../workspace-tabs/components/SuggestPrModal.jsx';
import { getWorkspaceMeta } from '../../../../workspace-tabs/workspace-tabs-service.js';

// No state of its own beyond "which tab": SuggestPrModal (and, for a tab
// aggregated from a set, SuggestAggregatedPrsModal) already handle linking
// and everything after it as their own phases, so opening the right one for
// the active tab is all this entry point needs to do. See TabBar.jsx's own
// routing for why a presence check on AggregationProvenance is enough --
// aggregation and single-file linking are mutually exclusive tab states.
const SuggestPrMenuItemHandler = forwardRef(({ getComponent, editorActions }, ref) => {
  const [tabId, setTabId] = useState(null);

  useImperativeHandle(ref, () => ({
    openModal() {
      setTabId(getWorkspaceMeta().activeTabId);
    },
  }));

  const isAggregated = tabId !== null && Boolean(getAggregationProvenance(tabId));

  return (
    <>
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen={tabId !== null && isAggregated}
        tabId={tabId}
        onClose={() => setTabId(null)}
      />
      <SuggestPrModal
        getComponent={getComponent}
        isOpen={tabId !== null && !isAggregated}
        tabId={tabId}
        editorActions={editorActions}
        onClose={() => setTabId(null)}
      />
    </>
  );
});

SuggestPrMenuItemHandler.displayName = 'SuggestPrMenuItemHandler';

SuggestPrMenuItemHandler.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorActions: PropTypes.shape({
    convertContentToJSON: PropTypes.func.isRequired,
    convertContentToYAML: PropTypes.func.isRequired,
  }).isRequired,
};

export default SuggestPrMenuItemHandler;
