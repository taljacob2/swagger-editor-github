import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import YAML from 'js-yaml';

import { buildSubsetSpec, listOperations, parseSpecContent } from '../export-subset-service.js';

const emptyState = { error: null, spec: null, operations: [], selectedKeys: new Set() };

// A developer with a large API showing a client "here's specifically how
// you'd use this" needs an actual smaller document to hand over, not just a
// narrower view of the one already open -- so this builds and downloads a
// real subset spec (paths, plus only the components/tags that subset still
// references) rather than filtering what the Preview pane renders.
const ExportSubsetModal = ({ getComponent, isOpen, onClose, editorSelectors, editorActions }) => {
  const [state, setState] = useState(emptyState);

  const Modal = getComponent('Modal', true);
  const ModalHeader = getComponent('ModalHeader');
  const ModalTitle = getComponent('ModalTitle');
  const ModalBody = getComponent('ModalBody');
  const ModalFooter = getComponent('ModalFooter');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    try {
      const spec = parseSpecContent(editorSelectors.selectContent());
      const operations = listOperations(spec);
      setState({
        error: null,
        spec,
        operations,
        selectedKeys: new Set(operations.map((operation) => operation.key)),
      });
    } catch (error) {
      setState({ ...emptyState, error: error.message });
    }
    // Only re-parse when the modal is (re-)opened -- editorSelectors reads
    // whatever's in the editor at that moment, not on every keystroke while
    // the picker is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    setState(emptyState);
    onClose();
  };

  const handleToggleClick = (key) => {
    setState((prev) => {
      const nextSelectedKeys = new Set(prev.selectedKeys);
      if (nextSelectedKeys.has(key)) {
        nextSelectedKeys.delete(key);
      } else {
        nextSelectedKeys.add(key);
      }
      return { ...prev, selectedKeys: nextSelectedKeys };
    });
  };

  const handleExportClick = () => {
    const subset = buildSubsetSpec(state.spec, state.selectedKeys);
    const isYAML = editorSelectors.selectIsContentFormatYAML();
    const content = isYAML ? YAML.dump(subset, { lineWidth: -1 }) : JSON.stringify(subset, null, 2);
    const baseName = editorSelectors.selectInferFileNameFromContent();
    const fileNameWithExtension = `${baseName}-subset${isYAML ? '.yaml' : '.json'}`;

    editorActions.downloadContent({ content, fileNameWithExtension });
    handleClose();
  };

  const { error, operations, selectedKeys } = state;

  return (
    <Modal isOpen={isOpen} contentLabel="Export Subset" onRequestClose={handleClose}>
      <ModalHeader>
        <button type="button" className="close" onClick={handleClose}>
          <span aria-hidden="true">x</span>
        </button>
        <ModalTitle>Export Subset</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {error && (
          <p className="swagger-editor__export-subset-note">
            Couldn&apos;t read the current spec: {error}
          </p>
        )}
        {!error && operations.length === 0 && (
          <p className="swagger-editor__export-subset-note">No endpoints found to export.</p>
        )}
        {!error && operations.length > 0 && (
          <ul className="swagger-editor__export-subset-list">
            {operations.map((operation) => (
              <li key={operation.key} className="swagger-editor__export-subset-row">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(operation.key)}
                    onChange={() => handleToggleClick(operation.key)}
                  />
                  <span
                    className={`swagger-editor__export-subset-method swagger-editor__export-subset-method--${operation.method}`}
                  >
                    {operation.method.toUpperCase()}
                  </span>
                  <span className="swagger-editor__export-subset-path">{operation.path}</span>
                  {operation.summary && (
                    <span className="swagger-editor__export-subset-summary">
                      {operation.summary}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="swagger-editor__export-subset-count">
          {selectedKeys.size} of {operations.length} endpoint{operations.length === 1 ? '' : 's'}{' '}
          selected
        </span>
        <button type="button" className="btn btn-secondary" onClick={handleClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleExportClick}
          disabled={Boolean(error) || selectedKeys.size === 0}
        >
          Export
        </button>
      </ModalFooter>
    </Modal>
  );
};

ExportSubsetModal.propTypes = {
  getComponent: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  editorSelectors: PropTypes.shape({
    selectContent: PropTypes.func.isRequired,
    selectIsContentFormatYAML: PropTypes.func.isRequired,
    selectInferFileNameFromContent: PropTypes.func.isRequired,
  }).isRequired,
  editorActions: PropTypes.shape({
    downloadContent: PropTypes.func.isRequired,
  }).isRequired,
};

export default ExportSubsetModal;
