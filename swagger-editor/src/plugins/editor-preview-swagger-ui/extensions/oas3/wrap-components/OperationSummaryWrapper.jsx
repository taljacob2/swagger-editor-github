import React from 'react';
import PropTypes from 'prop-types';

import { getWorkspaceMeta } from '../../../../workspace-tabs/workspace-tabs-service.js';
import { removeOperationFromContent } from '../../../operation-filter-service.js';

// Every checkbox here is always checked: if a row is rendering at all, its
// operation is -- by definition -- still in the spec. Unchecking removes it
// from the spec right away, but it's not gone for good -- the removal is
// recorded (see RemovedOperationsBanner.jsx, and OperationTagWrapper.jsx's
// own per-tag "Restore all") so it can be put back later, unlike a plain
// Ctrl+Z, which stops working the moment anything else gets edited.
//
// This lets a developer with a large API hide the endpoints they don't want
// to discuss with a client, then use File > Save As / Download -- features
// the editor already has -- on what's left, rather than needing a
// dedicated export flow.
const OperationSummaryWrapper = (Original, system) => {
  const Wrapped = (props) => {
    const { specPath } = props;
    const { editorSelectors, editorActions, editorPreviewSwaggerUIActions, EditorContentOrigin } =
      system;

    if (editorSelectors.selectContentIsReadOnly()) {
      return <Original {...props} />; // eslint-disable-line react/jsx-props-no-spreading
    }

    const path = specPath.get(1);
    const method = specPath.get(2);

    const handleRemoveClick = () => {
      const content = editorSelectors.selectContent();
      const isYAML = editorSelectors.selectIsContentFormatYAML();
      const result = removeOperationFromContent(content, path, method, isYAML);
      if (result !== null) {
        editorActions.setContent(result.content, EditorContentOrigin.EndpointFilter);
        editorPreviewSwaggerUIActions.recordOperationRemovals({
          tabId: getWorkspaceMeta().activeTabId,
          records: [result.record],
        });
      }
    };

    return (
      <div className="swagger-editor__operation-filter-row">
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label
          className="swagger-editor__operation-filter-checkbox"
          title="Remove this endpoint from the spec"
        >
          <input type="checkbox" checked onChange={handleRemoveClick} />
        </label>
        <Original {...props} /> {/* eslint-disable-line react/jsx-props-no-spreading */}
      </div>
    );
  };

  Wrapped.propTypes = {
    // eslint-disable-next-line react/forbid-prop-types
    specPath: PropTypes.object.isRequired, // Immutable List: ['paths', path, method]
  };

  return Wrapped;
};

export default OperationSummaryWrapper;
