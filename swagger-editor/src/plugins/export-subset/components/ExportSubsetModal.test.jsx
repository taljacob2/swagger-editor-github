import React from 'react';
import PropTypes from 'prop-types';
import { fireEvent, render, screen } from '@testing-library/react';

import ExportSubsetModal from './ExportSubsetModal.jsx';

const StubModal = ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null);
StubModal.propTypes = { isOpen: PropTypes.bool.isRequired, children: PropTypes.node.isRequired };

const StubPassthrough = ({ children }) => <div>{children}</div>;
StubPassthrough.propTypes = { children: PropTypes.node.isRequired };

const COMPONENTS = {
  Modal: StubModal,
  ModalHeader: StubPassthrough,
  ModalTitle: StubPassthrough,
  ModalBody: StubPassthrough,
  ModalFooter: StubPassthrough,
};

const getComponent = (name) => COMPONENTS[name];

const SPEC_YAML = [
  'openapi: 3.0.0',
  'info:',
  '  title: Petstore',
  'paths:',
  '  /pet:',
  '    post:',
  '      summary: Add a new pet',
  '      responses:',
  "        '200':",
  "          $ref: '#/components/responses/PetResponse'",
  '  /store/order:',
  '    get:',
  '      summary: Find purchase order',
  'components:',
  '  responses:',
  '    PetResponse:',
  '      description: a pet',
].join('\n');

const renderModal = (editorSelectorsOverride) => {
  const editorSelectors = editorSelectorsOverride || {
    selectContent: vi.fn().mockReturnValue(SPEC_YAML),
    selectIsContentFormatYAML: vi.fn().mockReturnValue(true),
    selectInferFileNameFromContent: vi.fn().mockReturnValue('openapi3_0'),
  };
  const editorActions = { downloadContent: vi.fn() };
  const onClose = vi.fn();

  render(
    <ExportSubsetModal
      getComponent={getComponent}
      isOpen
      onClose={onClose}
      editorSelectors={editorSelectors}
      editorActions={editorActions}
    />
  );

  return { editorSelectors, editorActions, onClose };
};

describe('ExportSubsetModal', () => {
  test('lists every operation, all selected by default', () => {
    renderModal();

    expect(screen.getByRole('checkbox', { name: /POST.*\/pet/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /GET.*\/store\/order/ })).toBeChecked();
    expect(screen.getByText('2 of 2 endpoints selected')).toBeInTheDocument();
  });

  test('unchecking an operation updates the selected count', () => {
    renderModal();

    fireEvent.click(screen.getByRole('checkbox', { name: /GET.*\/store\/order/ }));

    expect(screen.getByText('1 of 2 endpoints selected')).toBeInTheDocument();
  });

  test('Export downloads only the selected operations and their reachable components', () => {
    const { editorActions, onClose } = renderModal();

    fireEvent.click(screen.getByRole('checkbox', { name: /GET.*\/store\/order/ }));
    fireEvent.click(screen.getByText('Export'));

    expect(editorActions.downloadContent).toHaveBeenCalledTimes(1);
    const { content, fileNameWithExtension } = editorActions.downloadContent.mock.calls[0][0];
    expect(fileNameWithExtension).toBe('openapi3_0-subset.yaml');
    expect(content).toContain('/pet');
    expect(content).not.toContain('/store/order');
    expect(content).toContain('PetResponse');
    expect(onClose).toHaveBeenCalled();
  });

  test('Export is disabled once every operation is unchecked', () => {
    renderModal();

    fireEvent.click(screen.getByRole('checkbox', { name: /POST.*\/pet/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /GET.*\/store\/order/ }));

    expect(screen.getByText('Export')).toBeDisabled();
  });

  test('shows a friendly message instead of crashing on unparsable content', () => {
    renderModal({
      selectContent: vi.fn().mockReturnValue('{ not: valid: yaml: ['),
      selectIsContentFormatYAML: vi.fn().mockReturnValue(true),
      selectInferFileNameFromContent: vi.fn().mockReturnValue('openapi3_0'),
    });

    expect(screen.getByText(/Couldn't read the current spec/)).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeDisabled();
  });

  test('Cancel closes without downloading anything', () => {
    const { editorActions, onClose } = renderModal();

    fireEvent.click(screen.getByText('Cancel'));

    expect(editorActions.downloadContent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
