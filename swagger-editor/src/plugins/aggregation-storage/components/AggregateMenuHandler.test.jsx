import React, { createRef } from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AggregateMenuHandler from './AggregateMenuHandler.jsx';
import * as githubConnectionService from '../../github-connection/github-connection-service.js';
import * as aggregationStorageService from '../aggregation-storage-service.js';
import * as aggregationMergeService from '../aggregation-merge-service.js';

vi.mock('../../github-connection/github-connection-service.js');
vi.mock('../aggregation-storage-service.js');
vi.mock('../aggregation-merge-service.js');

const StubModal = ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null);
StubModal.propTypes = { isOpen: PropTypes.bool.isRequired, children: PropTypes.node.isRequired };

const StubPassthrough = ({ children }) => <div>{children}</div>;
StubPassthrough.propTypes = { children: PropTypes.node.isRequired };

const StubConfirmDialog = ({ isOpen, children, onClose }) =>
  isOpen ? (
    <div>
      {children}
      <button type="button" onClick={() => onClose(true)}>
        Confirm Delete
      </button>
      <button type="button" onClick={() => onClose(false)}>
        Cancel Delete
      </button>
    </div>
  ) : null;
StubConfirmDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired,
  onClose: PropTypes.func.isRequired,
};

const stubComponents = {
  Modal: StubModal,
  ModalHeader: StubPassthrough,
  ModalTitle: StubPassthrough,
  ModalBody: StubPassthrough,
  ModalFooter: StubPassthrough,
  ConfirmDialog: StubConfirmDialog,
};

const getComponent = (name) => stubComponents[name];

const STORAGE_SETTINGS = {
  owner: 'taljacob2',
  repo: 'swagger-editor-github',
  branch: 'aggregation-data-default',
};
const CONNECTION_SETTINGS = {
  apiBaseUrl: 'https://api.github.com',
  token: 'test-token',
  fetchToken: '',
};
const EDITOR_CONTENT_ORIGIN = { Aggregation: 'aggregation' };

const openModal = async (ref) => {
  await act(async () => {
    ref.current.openModal();
  });
};

const renderHandler = (ref, editorActions = { setContent: vi.fn() }) => {
  render(
    <AggregateMenuHandler
      ref={ref}
      getComponent={getComponent}
      editorActions={editorActions}
      EditorContentOrigin={EDITOR_CONTENT_ORIGIN}
    />
  );
  return editorActions;
};

describe('AggregateMenuHandler', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue(CONNECTION_SETTINGS);
    aggregationStorageService.getStorageSettings.mockReturnValue(STORAGE_SETTINGS);
    aggregationStorageService.saveStorageSettings.mockImplementation((s) => s);
    aggregationStorageService.listAggregationSets.mockResolvedValue([]);
    aggregationStorageService.saveAggregationSet.mockResolvedValue({});
    aggregationStorageService.deleteAggregationSet.mockResolvedValue();
    aggregationStorageService.canWriteToStorage.mockResolvedValue(true);
    aggregationStorageService.getRepoDefaultBranch.mockResolvedValue(null);
    aggregationStorageService.doesBranchExist.mockResolvedValue(true);
    // aggregation-storage-service.js is auto-mocked at the top of this file
    // (its own pure-function correctness is covered by
    // aggregation-storage-service.test.js), so these integration tests need
    // real implementations of the branch-prefix helpers wired up.
    const BRANCH_PREFIX = 'aggregation-data-';
    aggregationStorageService.branchSuffixFromBranch.mockImplementation((branch) =>
      branch && branch.startsWith(BRANCH_PREFIX) ? branch.slice(BRANCH_PREFIX.length) : branch || ''
    );
    aggregationStorageService.buildBranchName.mockImplementation(
      (suffix) => `${BRANCH_PREFIX}${(suffix || '').trim() || 'default'}`
    );
  });

  test('openModal hydrates storage location fields and loads sets from storage', async () => {
    aggregationStorageService.listAggregationSets.mockResolvedValue([
      {
        id: 'set-1',
        name: 'Orders',
        swaggerUrls: [{ name: 'Billing API', url: 'https://x/o.yaml' }],
      },
    ]);
    const ref = createRef();
    renderHandler(ref);

    await openModal(ref);

    expect(screen.getByLabelText('Owner')).toHaveValue('taljacob2');
    expect(screen.getByLabelText('Repository')).toHaveValue('swagger-editor-github');
    expect(screen.getByLabelText('Branch')).toHaveValue('default');
    await waitFor(() => expect(screen.getByText('Orders', { exact: false })).toBeInTheDocument());
    expect(aggregationStorageService.listAggregationSets).toHaveBeenCalledWith(
      STORAGE_SETTINGS,
      CONNECTION_SETTINGS
    );
  });

  test('editing the storage location auto-saves and reloads after a debounce', async () => {
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);
    aggregationStorageService.saveStorageSettings.mockClear();
    aggregationStorageService.listAggregationSets.mockClear();

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'other-repo' } });

    // No manual save step -- the location auto-persists and auto-reloads a
    // short while after the user stops typing.
    await waitFor(
      () =>
        expect(aggregationStorageService.saveStorageSettings).toHaveBeenCalledWith({
          owner: 'taljacob2',
          repo: 'other-repo',
          branch: 'aggregation-data-default',
        }),
      { timeout: 2000 }
    );
    await waitFor(() =>
      expect(aggregationStorageService.listAggregationSets).toHaveBeenCalledWith(
        { owner: 'taljacob2', repo: 'other-repo', branch: 'aggregation-data-default' },
        CONNECTION_SETTINGS
      )
    );
  });

  test('closing the modal flushes an in-flight edit immediately, without waiting for the debounce', async () => {
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);
    aggregationStorageService.saveStorageSettings.mockClear();

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'other-repo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(aggregationStorageService.saveStorageSettings).toHaveBeenCalledWith({
      owner: 'taljacob2',
      repo: 'other-repo',
      branch: 'aggregation-data-default',
    });
  });

  test('shows whether the branch already exists or will be created', async () => {
    aggregationStorageService.doesBranchExist.mockResolvedValue(false);
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    await waitFor(() => expect(screen.getByText(/doesn't exist yet/)).toBeInTheDocument());

    aggregationStorageService.doesBranchExist.mockResolvedValue(true);
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'shared' } });

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.queryByText(/doesn't exist yet/)).not.toBeInTheDocument();
  });

  test('the Branch field shows the fixed prefix next to an editable suffix', async () => {
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    expect(screen.getByText('aggregation-data-')).toBeInTheDocument();
    expect(screen.getByLabelText('Branch')).toHaveValue('default');
  });

  test('the fixed prefix keeps a plain default-branch name like "main" from ever colliding', async () => {
    aggregationStorageService.getRepoDefaultBranch.mockResolvedValue('main');
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'main' } });
    });

    expect(document.querySelector('.swagger-editor__aggregate-alert--error')).toBeNull();
  });

  test('still blocks an exact full-branch match as a safety net', async () => {
    aggregationStorageService.getRepoDefaultBranch.mockResolvedValue('aggregation-data-shared');
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'shared' } });
    });

    expect(document.querySelector('.swagger-editor__aggregate-alert--error').textContent).toMatch(
      "is taljacob2/swagger-editor-github's default branch"
    );
    expect(screen.queryByText('New Set')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'default' } });
    });

    expect(document.querySelector('.swagger-editor__aggregate-alert--error')).toBeNull();
    expect(screen.getByText('New Set')).toBeInTheDocument();
  });

  test('creating a new set with an added URL calls saveAggregationSet with the right payload', async () => {
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    fireEvent.click(screen.getByText('New Set'));
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Orders' } });
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Orders API' } });
    fireEvent.change(screen.getByLabelText('Swagger URL'), {
      target: { value: 'https://x/orders.yaml' },
    });
    fireEvent.click(screen.getByText('Add URL'));

    expect(screen.getByText('Orders API')).toBeInTheDocument();
    expect(screen.getByText('https://x/orders.yaml')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Set'));
    });

    expect(aggregationStorageService.saveAggregationSet).toHaveBeenCalledWith(
      {
        id: null,
        name: 'Orders',
        swaggerUrls: [{ name: 'Orders API', url: 'https://x/orders.yaml' }],
      },
      STORAGE_SETTINGS,
      CONNECTION_SETTINGS
    );
  });

  test('rejects saving a set with no name', async () => {
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    fireEvent.click(screen.getByText('New Set'));
    await act(async () => {
      fireEvent.click(screen.getByText('Save Set'));
    });

    expect(aggregationStorageService.saveAggregationSet).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a name for this set.')).toBeInTheDocument();
  });

  test('Edit hydrates the form with the existing set', async () => {
    aggregationStorageService.listAggregationSets.mockResolvedValue([
      {
        id: 'set-1',
        name: 'Orders',
        swaggerUrls: [{ name: 'Orders API', url: 'https://x/o.yaml' }],
      },
    ]);
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);
    await waitFor(() => screen.getByText('Edit'));

    fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByLabelText('Set name')).toHaveValue('Orders');
    expect(screen.getByText('Orders API')).toBeInTheDocument();
    expect(screen.getByText('https://x/o.yaml')).toBeInTheDocument();
  });

  test('shows each service as a chip on the set card', async () => {
    aggregationStorageService.listAggregationSets.mockResolvedValue([
      {
        id: 'set-1',
        name: 'Public API',
        swaggerUrls: [
          { name: 'Users', url: 'https://x/users.yaml' },
          { name: 'Orders', url: 'https://x/orders.yaml' },
        ],
      },
    ]);
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);

    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument());
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('2 services')).toBeInTheDocument();
  });

  describe('add-service fields collapse by default when editing an existing set', () => {
    test('New Set starts with the add-service fields already expanded', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);

      fireEvent.click(screen.getByText('New Set'));

      expect(screen.getByLabelText('Service name')).toBeInTheDocument();
      expect(screen.getByLabelText('Swagger URL')).toBeInTheDocument();
      expect(screen.queryByText('+ Add Service')).not.toBeInTheDocument();
    });

    test('editing a set that already has services starts collapsed, hiding the fields', async () => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([
        {
          id: 'set-1',
          name: 'Orders',
          swaggerUrls: [{ name: 'Orders API', url: 'https://x/o.yaml' }],
        },
      ]);
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Edit'));

      fireEvent.click(screen.getByText('Edit'));

      expect(screen.getByText('+ Add Service')).toBeInTheDocument();
      expect(screen.queryByLabelText('Service name')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Swagger URL')).not.toBeInTheDocument();
    });

    test('editing a set with no services yet starts expanded, since there is nothing else to do', async () => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([
        { id: 'set-1', name: 'Empty Set', swaggerUrls: [] },
      ]);
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Edit'));

      fireEvent.click(screen.getByText('Edit'));

      expect(screen.getByLabelText('Service name')).toBeInTheDocument();
      expect(screen.queryByText('+ Add Service')).not.toBeInTheDocument();
    });

    test('clicking + Add Service reveals the fields', async () => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([
        {
          id: 'set-1',
          name: 'Orders',
          swaggerUrls: [{ name: 'Orders API', url: 'https://x/o.yaml' }],
        },
      ]);
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Edit'));

      fireEvent.click(screen.getByText('+ Add Service'));

      expect(screen.getByLabelText('Service name')).toBeInTheDocument();
      expect(screen.getByLabelText('Swagger URL')).toBeInTheDocument();
    });

    test('Done collapses the fields again and discards unsaved input', async () => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([
        {
          id: 'set-1',
          name: 'Orders',
          swaggerUrls: [{ name: 'Orders API', url: 'https://x/o.yaml' }],
        },
      ]);
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.click(screen.getByText('+ Add Service'));
      fireEvent.change(screen.getByLabelText('Service name'), {
        target: { value: 'should be discarded' },
      });

      fireEvent.click(screen.getByLabelText('Hide add-service fields'));

      expect(screen.getByText('+ Add Service')).toBeInTheDocument();
      expect(screen.queryByLabelText('Service name')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('+ Add Service'));
      expect(screen.getByLabelText('Service name')).toHaveValue('');
    });

    test('adding a service keeps the fields open, ready for another', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);

      fireEvent.click(screen.getByText('New Set'));
      fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Users' } });
      fireEvent.change(screen.getByLabelText('Swagger URL'), {
        target: { value: 'https://x/users.yaml' },
      });
      fireEvent.click(screen.getByText('Add URL'));

      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.getByLabelText('Service name')).toBeInTheDocument();
      expect(screen.queryByText('+ Add Service')).not.toBeInTheDocument();
    });
  });

  describe('reordering services in the edit form', () => {
    const THREE_SERVICE_SET = {
      id: 'set-1',
      name: 'Public API',
      swaggerUrls: [
        { name: 'Users', url: 'https://x/users.yaml' },
        { name: 'Orders', url: 'https://x/orders.yaml' },
        { name: 'Billing', url: 'https://x/billing.yaml' },
      ],
    };

    beforeEach(() => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([THREE_SERVICE_SET]);
      // aggregation-storage-service.js is auto-mocked at the top of this file
      // (its own pure-function correctness is covered by
      // aggregation-storage-service.test.js), so these integration tests need
      // a real implementation wired up to actually see the reorder happen.
      aggregationStorageService.moveSwaggerUrl.mockImplementation(
        (swaggerUrls, index, direction) => {
          const targetIndex = direction === 'up' ? index - 1 : index + 1;
          if (targetIndex < 0 || targetIndex >= swaggerUrls.length) {
            return swaggerUrls;
          }
          const next = [...swaggerUrls];
          [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
          return next;
        }
      );
    });

    const openEditForm = async (ref) => {
      await openModal(ref);
      await waitFor(() => screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Edit'));
    };

    const rowOrder = () =>
      screen
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.swagger-editor__aggregate-url-name').textContent);

    test('the first row cannot move up, the last row cannot move down', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      const moveUpButtons = screen.getAllByLabelText('Move up');
      const moveDownButtons = screen.getAllByLabelText('Move down');

      expect(moveUpButtons[0]).toBeDisabled();
      expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled();
      expect(moveUpButtons[1]).not.toBeDisabled();
      expect(moveDownButtons[0]).not.toBeDisabled();
    });

    test('moving a service down reorders it, and Save Set persists the new order', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      expect(rowOrder()).toEqual(['Users', 'Orders', 'Billing']);

      fireEvent.click(screen.getAllByLabelText('Move down')[0]);

      expect(rowOrder()).toEqual(['Orders', 'Users', 'Billing']);

      await act(async () => {
        fireEvent.click(screen.getByText('Save Set'));
      });

      expect(aggregationStorageService.saveAggregationSet).toHaveBeenCalledWith(
        {
          id: 'set-1',
          name: 'Public API',
          swaggerUrls: [
            { name: 'Orders', url: 'https://x/orders.yaml' },
            { name: 'Users', url: 'https://x/users.yaml' },
            { name: 'Billing', url: 'https://x/billing.yaml' },
          ],
        },
        STORAGE_SETTINGS,
        CONNECTION_SETTINGS
      );
    });

    test('moving the middle service up reorders it', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Move up')[1]);

      expect(rowOrder()).toEqual(['Orders', 'Users', 'Billing']);
    });
  });

  describe('editing a service in the edit form', () => {
    const TWO_SERVICE_SET = {
      id: 'set-1',
      name: 'Public API',
      swaggerUrls: [
        { name: 'Users', url: 'https://x/users.yaml' },
        { name: 'Orders', url: 'https://x/orders.yaml' },
      ],
    };

    beforeEach(() => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([TWO_SERVICE_SET]);
    });

    const openEditForm = async (ref) => {
      await openModal(ref);
      await waitFor(() => screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Edit'));
    };

    test('clicking Edit on a row shows prefilled fields and Save/Cancel instead of Move/Remove', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);

      expect(screen.getByLabelText('Edit service name')).toHaveValue('Users');
      expect(screen.getByLabelText('Edit Swagger URL')).toHaveValue('https://x/users.yaml');
      // Only the (untouched) Orders row still shows a Move up button -- the
      // Users row being edited has swapped its Move/Remove for Save/Cancel.
      const moveUpButtons = screen.getAllByLabelText('Move up');
      expect(moveUpButtons).toHaveLength(1);
      expect(moveUpButtons[0]).toBeDisabled();
      // "Cancel" also matches the form's own footer button -- there should be
      // exactly two now (row-level + form-level).
      expect(screen.getAllByText('Cancel')).toHaveLength(2);
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    test('editing and saving updates that row, leaving the other untouched', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);
      fireEvent.change(screen.getByLabelText('Edit service name'), {
        target: { value: 'Users API' },
      });
      fireEvent.change(screen.getByLabelText('Edit Swagger URL'), {
        target: { value: 'https://x/users-v2.yaml' },
      });
      fireEvent.click(screen.getByText('Save'));

      expect(screen.getByText('Users API')).toBeInTheDocument();
      expect(screen.getByText('https://x/users-v2.yaml')).toBeInTheDocument();
      expect(screen.getByText('Orders')).toBeInTheDocument();
      expect(screen.getByText('https://x/orders.yaml')).toBeInTheDocument();
      expect(screen.queryByLabelText('Edit service name')).not.toBeInTheDocument();
    });

    test('Cancel discards changes and restores the original values', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);
      fireEvent.change(screen.getByLabelText('Edit service name'), {
        target: { value: 'Something else entirely' },
      });
      // The row-level Cancel is the first of the two "Cancel" buttons on
      // screen (row-level, then the form's own footer Cancel).
      fireEvent.click(screen.getAllByText('Cancel')[0]);

      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.queryByText('Something else entirely')).not.toBeInTheDocument();
    });

    test('an empty URL disables Save', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);
      fireEvent.change(screen.getByLabelText('Edit Swagger URL'), { target: { value: '   ' } });

      expect(screen.getByText('Save')).toBeDisabled();
    });

    test('saving with a blank name falls back to a positional default', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[1]);
      fireEvent.change(screen.getByLabelText('Edit service name'), { target: { value: '  ' } });
      fireEvent.click(screen.getByText('Save'));

      expect(screen.getByText('Service 2')).toBeInTheDocument();
    });

    test('Move/Remove/Edit on other rows and the Add Service toggle are disabled while a row is being edited', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);

      // A set with existing services starts with the add-service fields
      // collapsed, so the collapsed toggle button is what must be disabled.
      expect(screen.getByText('+ Add Service')).toBeDisabled();
      // Only the row being edited remains -- its Move/Remove are replaced by
      // Save/Cancel, so any surviving "Remove" belongs to a different, still
      // -displayed row and must be disabled.
      screen.getAllByText('Remove').forEach((button) => expect(button).toBeDisabled());
    });

    test('Enter saves, Escape cancels', async () => {
      const ref = createRef();
      renderHandler(ref);
      await openEditForm(ref);

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);
      fireEvent.change(screen.getByLabelText('Edit service name'), {
        target: { value: 'Users API' },
      });
      fireEvent.keyDown(screen.getByLabelText('Edit service name'), { key: 'Enter' });

      expect(screen.getByText('Users API')).toBeInTheDocument();

      fireEvent.click(screen.getAllByLabelText('Edit')[0]);
      fireEvent.change(screen.getByLabelText('Edit service name'), {
        target: { value: 'discarded' },
      });
      fireEvent.keyDown(screen.getByLabelText('Edit service name'), { key: 'Escape' });

      expect(screen.getByText('Users API')).toBeInTheDocument();
      expect(screen.queryByText('discarded')).not.toBeInTheDocument();
    });
  });

  test('Delete asks for confirmation before calling deleteAggregationSet', async () => {
    aggregationStorageService.listAggregationSets.mockResolvedValue([
      { id: 'set-1', name: 'Orders', swaggerUrls: [] },
    ]);
    const ref = createRef();
    renderHandler(ref);
    await openModal(ref);
    await waitFor(() => screen.getByText('Delete'));

    fireEvent.click(screen.getByText('Delete'));
    expect(aggregationStorageService.deleteAggregationSet).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Confirm Delete'));
    });

    expect(aggregationStorageService.deleteAggregationSet).toHaveBeenCalledWith(
      'set-1',
      STORAGE_SETTINGS,
      CONNECTION_SETTINGS
    );
  });

  describe('read-only tokens (no write access to the storage repo)', () => {
    beforeEach(() => {
      aggregationStorageService.canWriteToStorage.mockResolvedValue(false);
      aggregationStorageService.listAggregationSets.mockResolvedValue([
        { id: 'set-1', name: 'Orders', swaggerUrls: [] },
      ]);
    });

    test("hides New Set and each set's Edit/Delete, and shows a read-only note", async () => {
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Orders', { exact: false }));

      expect(screen.queryByText('New Set')).not.toBeInTheDocument();
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
      expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    });

    test('Aggregate stays available', async () => {
      aggregationMergeService.aggregateSet.mockResolvedValue({
        yaml: 'openapi: 3.0.0\n',
        conflicts: { paths: [], tags: [], components: [] },
        errors: [],
        specCount: 1,
      });
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Aggregate'));

      await act(async () => {
        fireEvent.click(screen.getByText('Aggregate'));
      });

      expect(aggregationMergeService.aggregateSet).toHaveBeenCalled();
    });
  });

  describe('permission-denied errors', () => {
    const forbidden = () =>
      Object.assign(new Error('GitHub API PUT ... failed: 403'), { status: 403 });

    test('Save shows a friendlier message on a 403', async () => {
      aggregationStorageService.saveAggregationSet.mockRejectedValue(forbidden());
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);

      fireEvent.click(screen.getByText('New Set'));
      fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Orders' } });
      await act(async () => {
        fireEvent.click(screen.getByText('Save Set'));
      });

      expect(screen.getByText(/don't have write access/)).toBeInTheDocument();
    });

    test('Delete shows a friendlier message on a 403', async () => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([
        { id: 'set-1', name: 'Orders', swaggerUrls: [] },
      ]);
      aggregationStorageService.deleteAggregationSet.mockRejectedValue(forbidden());
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Delete'));

      fireEvent.click(screen.getByText('Delete'));
      await act(async () => {
        fireEvent.click(screen.getByText('Confirm Delete'));
      });

      expect(screen.getByText(/don't have write access/)).toBeInTheDocument();
    });
  });

  describe('Aggregate', () => {
    const SET = {
      id: 'set-1',
      name: 'Orders',
      swaggerUrls: [{ name: 'Orders', url: 'https://x/o.yaml' }],
    };

    beforeEach(() => {
      aggregationStorageService.listAggregationSets.mockResolvedValue([SET]);
    });

    test('loads the merged result into the editor via setContent', async () => {
      aggregationMergeService.aggregateSet.mockResolvedValue({
        yaml: 'openapi: 3.0.0\n',
        conflicts: { paths: [], tags: [], components: [] },
        errors: [],
        specCount: 1,
      });
      const ref = createRef();
      const editorActions = renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Aggregate'));

      await act(async () => {
        fireEvent.click(screen.getByText('Aggregate'));
      });

      expect(aggregationMergeService.aggregateSet).toHaveBeenCalledWith(SET, CONNECTION_SETTINGS);
      expect(editorActions.setContent).toHaveBeenCalledWith('openapi: 3.0.0\n', 'aggregation');
      expect(
        screen.getByText(/Loaded "Orders" into the editor: 1 spec\(s\) merged\./)
      ).toBeInTheDocument();
    });

    test('mentions resolved conflicts and failed URLs in the status message', async () => {
      aggregationMergeService.aggregateSet.mockResolvedValue({
        yaml: 'openapi: 3.0.0\n',
        conflicts: { paths: [{ path: '/x', services: ['A', 'B'] }], tags: [], components: [] },
        errors: [{ name: 'Broken', message: 'HTTP 500: Server Error' }],
        specCount: 1,
      });
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Aggregate'));

      await act(async () => {
        fireEvent.click(screen.getByText('Aggregate'));
      });

      expect(
        screen.getByRole('button', { name: 'resolved 1 naming conflict' })
      ).toBeInTheDocument();
      expect(screen.getByText(/\(1 URL failed: Broken\)/)).toBeInTheDocument();
    });

    test('clicking the conflict summary reveals per-service renamed details', async () => {
      aggregationMergeService.aggregateSet.mockResolvedValue({
        yaml: 'openapi: 3.0.0\n',
        conflicts: {
          paths: [
            {
              path: '/profile',
              services: ['Users', 'Orders'],
              renamed: [
                { service: 'Users', to: '/users/profile' },
                { service: 'Orders', to: '/orders/profile' },
              ],
            },
          ],
          tags: [],
          components: [],
        },
        errors: [],
        specCount: 2,
      });
      const ref = createRef();
      renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Aggregate'));

      await act(async () => {
        fireEvent.click(screen.getByText('Aggregate'));
      });

      const toggle = screen.getByRole('button', { name: 'resolved 1 naming conflict' });
      expect(screen.queryByText('/users/profile')).not.toBeInTheDocument();

      fireEvent.click(toggle);

      expect(screen.getByText('/profile')).toBeInTheDocument();
      expect(screen.getByText('/users/profile')).toBeInTheDocument();
      expect(screen.getByText('/orders/profile')).toBeInTheDocument();

      fireEvent.click(toggle);

      expect(screen.queryByText('/users/profile')).not.toBeInTheDocument();
    });

    test('reports an aggregation failure without crashing', async () => {
      aggregationMergeService.aggregateSet.mockRejectedValue(
        new Error('No specs could be fetched for this set.')
      );
      const ref = createRef();
      const editorActions = renderHandler(ref);
      await openModal(ref);
      await waitFor(() => screen.getByText('Aggregate'));

      await act(async () => {
        fireEvent.click(screen.getByText('Aggregate'));
      });

      expect(screen.getByText('No specs could be fetched for this set.')).toBeInTheDocument();
      expect(editorActions.setContent).not.toHaveBeenCalled();
    });
  });
});
