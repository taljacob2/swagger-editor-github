import { useImperativeHandle, useState, forwardRef } from 'react';
import PropTypes from 'prop-types';

import ExportSubsetModal from '../../../../export-subset/components/ExportSubsetModal.jsx';

const ExportSubsetMenuItemHandler = forwardRef(
  ({ getComponent, editorSelectors, editorActions }, ref) => {
    const [isOpen, setIsOpen] = useState(false);

    useImperativeHandle(ref, () => ({
      openModal() {
        setIsOpen(true);
      },
    }));

    return (
      <ExportSubsetModal
        getComponent={getComponent}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        editorSelectors={editorSelectors}
        editorActions={editorActions}
      />
    );
  }
);

ExportSubsetMenuItemHandler.displayName = 'ExportSubsetMenuItemHandler';

ExportSubsetMenuItemHandler.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorSelectors: PropTypes.shape({
    selectContent: PropTypes.func.isRequired,
    selectIsContentFormatYAML: PropTypes.func.isRequired,
    selectInferFileNameFromContent: PropTypes.func.isRequired,
  }).isRequired,
  editorActions: PropTypes.shape({
    downloadContent: PropTypes.func.isRequired,
  }).isRequired,
};

export default ExportSubsetMenuItemHandler;
