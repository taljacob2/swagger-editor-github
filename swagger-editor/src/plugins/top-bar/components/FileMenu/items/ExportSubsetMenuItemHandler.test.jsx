import React, { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';

import ExportSubsetMenuItemHandler from './ExportSubsetMenuItemHandler.jsx';

// ExportSubsetModal's own flow (parsing, the checklist, exporting) is
// covered by its own dedicated tests -- stubbed here down to just reporting
// whether it's open, so this file can focus on this entry point's own job:
// opening the modal on openModal().
vi.mock('../../../../export-subset/components/ExportSubsetModal.jsx', () => ({
  default: ({ isOpen }) => (isOpen ? <div>Export Subset modal open</div> : null),
}));

const getComponent = () => null;
const editorSelectors = {
  selectContent: vi.fn(),
  selectIsContentFormatYAML: vi.fn(),
  selectInferFileNameFromContent: vi.fn(),
};
const editorActions = { downloadContent: vi.fn() };

describe('ExportSubsetMenuItemHandler', () => {
  test('is closed until openModal() is called via ref', () => {
    const ref = createRef();
    render(
      <ExportSubsetMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorSelectors={editorSelectors}
        editorActions={editorActions}
      />
    );

    expect(screen.queryByText('Export Subset modal open')).not.toBeInTheDocument();
  });

  test('openModal() opens the modal', () => {
    const ref = createRef();
    render(
      <ExportSubsetMenuItemHandler
        ref={ref}
        getComponent={getComponent}
        editorSelectors={editorSelectors}
        editorActions={editorActions}
      />
    );

    act(() => ref.current.openModal());

    expect(screen.getByText('Export Subset modal open')).toBeInTheDocument();
  });
});
