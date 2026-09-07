import React from 'react';
import PropTypes from 'prop-types';

import { removeOperationFromContent } from '../../../operation-filter-service.js';

// Every checkbox here is always checked: if a row is rendering at all, its
// operation is -- by definition -- still in the spec. Unchecking is a
// one-way "remove this endpoint from the spec, right now" action, not a
// two-way selection the way a picker's checkboxes would be -- there's
// nothing to render an unchecked row *as* once its operation is gone, so
// there's no "recheck it" affordance here. Undo is Monaco's own Ctrl+Z, the
// same as deleting the operation's YAML by hand.
//
// This lets a developer with a large API hide (i.e. delete) the endpoints
// they don't want to discuss with a client, then use File > Save As /
// Download -- features the editor already has -- on what's left, rather
// than needing a dedicated export flow.
const OperationSummaryWrapper = (Original, system) => {
  const Wrapped = (props) => {
    const { specPath } = props;
    const { editorSelectors, editorActions, EditorContentOrigin } = system;

    if (editorSelectors.selectContentIsReadOnly()) {
      return <Original {...props} />; // eslint-disable-line react/jsx-props-no-spreading
    }

    const path = specPath.get(1);
    const method = specPath.get(2);

    const handleRemoveClick = () => {
      const content = editorSelectors.selectContent();
      const isYAML = editorSelectors.selectIsContentFormatYAML();
      const nextContent = removeOperationFromContent(content, path, method, isYAML);
      if (nextContent !== null) {
        editorActions.setContent(nextContent, EditorContentOrigin.EndpointFilter);
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
