import { useEffect } from 'react';
import PropTypes from 'prop-types';

const EditorPreviewSwaggerUI = ({ getComponent, editorPreviewSwaggerUIActions }) => {
  const BaseLayout = getComponent('BaseLayout', true); // accessed from swagger-ui
  const RemovedOperationsBanner = getComponent('RemovedOperationsBanner', true);

  useEffect(() => {
    return () => {
      editorPreviewSwaggerUIActions.previewUnmounted();
    };
  }, [editorPreviewSwaggerUIActions]);

  return (
    <div className="swagger-editor__editor-preview-swagger-ui">
      <RemovedOperationsBanner />
      <BaseLayout />
    </div>
  );
};

EditorPreviewSwaggerUI.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorPreviewSwaggerUIActions: PropTypes.shape({
    previewUnmounted: PropTypes.func.isRequired,
  }).isRequired,
};

export default EditorPreviewSwaggerUI;
