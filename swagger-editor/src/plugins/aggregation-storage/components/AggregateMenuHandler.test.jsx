import React, { createRef } from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AggregateMenuHandler from './AggregateMenuHandler.jsx';
import * as githubConnectionService from '../../github-connection/github-connection-service.js';
import * as aggregationStorageService from '../aggregation-storage-service.js';

vi.mock('../../github-connection/github-connection-service.js');
vi.mock('../aggregation-storage-service.js');

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
  branch: 'aggregation-data',
};
const CONNECTION_SETTINGS = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };

const openModal = async (ref) => {
  await act(async () => {
    ref.current.openModal();
  });
};

describe('AggregateMenuHandler', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue(CONNECTION_SETTINGS);
    aggregationStorageService.getStorageSettings.mockReturnValue(STORAGE_SETTINGS);
    aggregationStorageService.saveStorageSettings.mockImplementation((s) => s);
    aggregationStorageService.listAggregationSets.mockResolvedValue([]);
    aggregationStorageService.saveAggregationSet.mockResolvedValue({});
    aggregationStorageService.deleteAggregationSet.mockResolvedValue();
  });

  test('openModal hydrates storage location fields and loads sets from storage', async () => {
    aggregationStorageService.listAggregationSets.mockResolvedValue([
      { id: 'set-1', name: 'Orders', swaggerUrls: [{ name: 'Orders', url: 'https://x/o.yaml' }] },
    ]);
    const ref = createRef();
    render(<AggregateMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    expect(screen.getByLabelText('Owner')).toHaveValue('taljacob2');
    expect(screen.getByLabelText('Repository')).toHaveValue('swagger-editor-github');
    expect(screen.getByLabelText('Branch')).toHaveValue('aggregation-data');
    await waitFor(() => expect(screen.getByText('Orders', { exact: false })).toBeInTheDocument());
    expect(aggregationStorageService.listAggregationSets).toHaveBeenCalledWith(
      STORAGE_SETTINGS,
      CONNECTION_SETTINGS
    );
  });

  test('Save Location persists edited owner/repo/branch and refreshes the list', async () => {
    const ref = createRef();
    render(<AggregateMenuHandler ref={ref} getComponent={getComponent} />);
    await openModal(ref);

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'other-repo' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Location'));
    });

    expect(aggregationStorageService.saveStorageSettings).toHaveBeenCalledWith({
      owner: 'taljacob2',
      repo: 'other-repo',
      branch: 'aggregation-data',
    });
    expect(screen.getByText('Storage location saved.')).toBeInTheDocument();
  });

  test('creating a new set with an added URL calls saveAggregationSet with the right payload', async () => {
    const ref = createRef();
    render(<AggregateMenuHandler ref={ref} getComponent={getComponent} />);
    await openModal(ref);

    fireEvent.click(screen.getByText('New Set'));
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Orders' } });
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Orders API' } });
    fireEvent.change(screen.getByLabelText('Swagger URL'), {
      target: { value: 'https://x/orders.yaml' },
    });
    fireEvent.click(screen.getByText('Add URL'));

    expect(screen.getByText(/Orders API: https:\/\/x\/orders\.yaml/)).toBeInTheDocument();

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
    render(<AggregateMenuHandler ref={ref} getComponent={getComponent} />);
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
    render(<AggregateMenuHandler ref={ref} getComponent={getComponent} />);
    await openModal(ref);
    await waitFor(() => screen.getByText('Edit'));

    fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByLabelText('Set name')).toHaveValue('Orders');
    expect(screen.getByText(/Orders API: https:\/\/x\/o\.yaml/)).toBeInTheDocument();
  });

  test('Delete asks for confirmation before calling deleteAggregationSet', async () => {
    aggregationStorageService.listAggregationSets.mockResolvedValue([
      { id: 'set-1', name: 'Orders', swaggerUrls: [] },
    ]);
    const ref = createRef();
    render(<AggregateMenuHandler ref={ref} getComponent={getComponent} />);
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
});
