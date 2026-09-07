import React from 'react';
import PropTypes from 'prop-types';

import { getWorkspaceMeta } from '../../../../workspace-tabs/workspace-tabs-service.js';
import { removeOperationsFromContent } from '../../../operation-filter-service.js';

// Bulk sibling to OperationSummaryWrapper.jsx's per-row checkbox: "Remove
// all" clears out every operation currently shown under this tag in one
// editor-content rewrite (rather than N separate ones), and "Restore all"
// brings back whichever of this tag's operations are still sitting in this
// tab's removed-operations history (see RemovedOperationsBanner.jsx) --
// nothing if none are, since removing every operation under a tag makes
// its whole section (this component included) stop rendering, same as one
// operation's own row disappearing.
const OperationTagWrapper = (Original, system) => {
  const Wrapped = (props) => {
    const { tag, tagObj } = props;
    const {
      editorSelectors,
      editorActions,
      editorPreviewSwaggerUIActions,
      editorPreviewSwaggerUISelectors,
      EditorContentOrigin,
    } = system;

    if (editorSelectors.selectContentIsReadOnly()) {
      return <Original {...props} />; // eslint-disable-line react/jsx-props-no-spreading
    }

    const keys = tagObj
      .get('operations')
      .map((operation) => ({ path: operation.get('path'), method: operation.get('method') }))
      .toArray();

    const { activeTabId } = getWorkspaceMeta();
    const removedForTag = editorPreviewSwaggerUISelectors
      .selectRemovedOperations(activeTabId)
      .filter((record) => (record.operation.tags || []).includes(tag));

    const handleRemoveAllClick = () => {
      const content = editorSelectors.selectContent();
      const isYAML = editorSelectors.selectIsContentFormatYAML();
      const result = removeOperationsFromContent(content, keys, isYAML);
      if (result !== null) {
        editorActions.setContent(result.content, EditorContentOrigin.EndpointFilter);
        editorPreviewSwaggerUIActions.recordOperationRemovals({
          tabId: activeTabId,
          records: result.records,
        });
      }
    };

    const handleRestoreAllClick = () => {
      editorPreviewSwaggerUIActions.restoreOperations(activeTabId, removedForTag);
    };

    return (
      <div className="swagger-editor__operation-tag-wrapper">
        <Original {...props} /> {/* eslint-disable-line react/jsx-props-no-spreading */}
        <div className="swagger-editor__operation-tag-actions">
          {keys.length > 0 && (
            <button
              type="button"
              className="swagger-editor__operation-tag-action"
              onClick={handleRemoveAllClick}
            >
              Remove all
            </button>
          )}
          {removedForTag.length > 0 && (
            <button
              type="button"
              className="swagger-editor__operation-tag-action"
              onClick={handleRestoreAllClick}
            >
              Restore all ({removedForTag.length})
            </button>
          )}
        </div>
      </div>
    );
  };

  Wrapped.propTypes = {
    tag: PropTypes.string.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    tagObj: PropTypes.object.isRequired, // Immutable Map: { operations: List }
  };

  return Wrapped;
};

export default OperationTagWrapper;
