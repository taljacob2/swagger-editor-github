import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import {
  getWorkspaceMeta,
  onWorkspaceChanged,
} from '../../workspace-tabs/workspace-tabs-service.js';

// The only way to get a removed endpoint back once its own row (and,
// possibly, its whole tag section) is gone from the Preview pane -- see
// OperationSummaryWrapper.jsx and OperationTagWrapper.jsx for how entries
// land here. Renders nothing once the active tab has nothing removed.
const RemovedOperationsBanner = ({
  editorPreviewSwaggerUISelectors,
  editorPreviewSwaggerUIActions,
}) => {
  const [workspace, setWorkspace] = useState(() => getWorkspaceMeta());
  useEffect(() => onWorkspaceChanged(() => setWorkspace(getWorkspaceMeta())), []);

  const { activeTabId } = workspace;
  const removedOperations = editorPreviewSwaggerUISelectors.selectRemovedOperations(activeTabId);

  if (removedOperations.length === 0) {
    return null;
  }

  return (
    <div className="swagger-editor__removed-operations-banner">
      <span className="swagger-editor__removed-operations-title">
        {removedOperations.length} endpoint{removedOperations.length === 1 ? '' : 's'} removed from
        this spec
      </span>
      <ul className="swagger-editor__removed-operations-list">
        {removedOperations.map((record) => (
          <li
            key={`${record.method} ${record.path}`}
            className="swagger-editor__removed-operations-item"
          >
            <span
              className={`swagger-editor__operation-filter-method swagger-editor__operation-filter-method--${record.method}`}
            >
              {record.method.toUpperCase()}
            </span>
            <span className="swagger-editor__removed-operations-path">{record.path}</span>
            <button
              type="button"
              className="swagger-editor__removed-operations-restore"
              onClick={() => editorPreviewSwaggerUIActions.restoreOperations(activeTabId, [record])}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

RemovedOperationsBanner.propTypes = {
  editorPreviewSwaggerUISelectors: PropTypes.shape({
    selectRemovedOperations: PropTypes.func.isRequired,
  }).isRequired,
  editorPreviewSwaggerUIActions: PropTypes.shape({
    restoreOperations: PropTypes.func.isRequired,
  }).isRequired,
};

export default RemovedOperationsBanner;
