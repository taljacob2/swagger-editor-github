import React, { useState, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';

import SuggestPrModal from '../../../../workspace-tabs/components/SuggestPrModal.jsx';
import { getWorkspaceMeta } from '../../../../workspace-tabs/workspace-tabs-service.js';

// No state of its own beyond "which tab": SuggestPrModal already handles
// linking (and everything after it) as its own phase, so opening it for the
// active tab -- linked or not -- is all this entry point needs to do.
const SuggestPrMenuItemHandler = forwardRef(({ getComponent, editorActions }, ref) => {
  const [tabId, setTabId] = useState(null);

  useImperativeHandle(ref, () => ({
    openModal() {
      setTabId(getWorkspaceMeta().activeTabId);
    },
  }));

  return (
    <SuggestPrModal
      getComponent={getComponent}
      isOpen={tabId !== null}
      tabId={tabId}
      editorActions={editorActions}
      onClose={() => setTabId(null)}
    />
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
