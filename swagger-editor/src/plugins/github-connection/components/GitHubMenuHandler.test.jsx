import React, { createRef } from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import GitHubMenuHandler from './GitHubMenuHandler.jsx';
import * as githubConnectionService from '../github-connection-service.js';
import * as aggregationStorageService from '../../aggregation-storage/aggregation-storage-service.js';

vi.mock('../github-connection-service.js');
vi.mock('../../aggregation-storage/aggregation-storage-service.js');

const StubModal = ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null);
StubModal.propTypes = { isOpen: PropTypes.bool.isRequired, children: PropTypes.node.isRequired };

const StubPassthrough = ({ children }) => <div>{children}</div>;
StubPassthrough.propTypes = { children: PropTypes.node.isRequired };

const StubLink = ({ href, children }) => <a href={href}>{children}</a>;
StubLink.propTypes = { href: PropTypes.string.isRequired, children: PropTypes.node.isRequired };

const stubComponents = {
  Modal: StubModal,
  ModalHeader: StubPassthrough,
  ModalTitle: StubPassthrough,
  ModalBody: StubPassthrough,
  ModalFooter: StubPassthrough,
  Link: StubLink,
};

const getComponent = (name) => stubComponents[name];

const openModal = async (ref) => {
  await act(async () => {
    await ref.current.openModal();
  });
};

describe('GitHubMenuHandler', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: 'stored-token',
      fetchToken: 'stored-fetch-token',
    });
    githubConnectionService.saveConnectionSettings.mockImplementation(async (settings) => settings);
    githubConnectionService.testConnection.mockResolvedValue({
      ok: true,
      message: 'Connected as taljacob2',
    });
    githubConnectionService.buildTokenCreationUrl.mockImplementation(
      ({ contents, targetName }) =>
        `https://github.com/settings/personal-access-tokens/new?contents=${contents}${
          targetName ? `&target_name=${targetName}` : ''
        }`
    );
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: '',
      repo: '',
      branch: 'aggregation-data',
    });
    aggregationStorageService.canWriteToStorage.mockResolvedValue(true);
  });

  test('is closed until openModal() is called via ref, then hydrates fields from stored settings', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();

    await openModal(ref);

    expect(githubConnectionService.getConnectionSettings).toHaveBeenCalled();
    expect(screen.getByLabelText('API base URL')).toHaveValue('https://api.github.com');
    expect(screen.getByLabelText('Repo token')).toHaveValue('stored-token');
    expect(screen.getByLabelText('Fetch token (optional — read-only, private repos)')).toHaveValue(
      'stored-fetch-token'
    );
  });

  test('Save persists edited fields via saveConnectionSettings', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    fireEvent.change(screen.getByLabelText('API base URL'), {
      target: { value: 'https://api.mycompany.ghe.com' },
    });
    fireEvent.change(screen.getByLabelText('Repo token'), {
      target: { value: 'new-token' },
    });
    fireEvent.change(screen.getByLabelText('Fetch token (optional — read-only, private repos)'), {
      target: { value: 'new-fetch-token' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(githubConnectionService.saveConnectionSettings).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.mycompany.ghe.com',
      token: 'new-token',
      fetchToken: 'new-fetch-token',
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  test('Connection reports the result from testConnection', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(screen.getByText('Connected as taljacob2')).toBeInTheDocument();
    });
    expect(githubConnectionService.testConnection).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.github.com',
      token: 'stored-token',
    });
  });

  test('Close hides the modal again', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    expect(screen.getByLabelText('API base URL')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close'));

    expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
  });

  test('defaults to "browse public" and shows no create-token link', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    expect(screen.getByText(/leave both token fields below blank/)).toBeInTheDocument();
    expect(screen.queryByText('Create a read-only token →')).not.toBeInTheDocument();
    expect(screen.queryByText('Create a write token →')).not.toBeInTheDocument();
  });

  test('"browse private" shows a read-only create-token link with no target_name', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.change(screen.getByLabelText('What do you want to do?'), {
      target: { value: 'browse-private' },
    });

    const link = screen.getByText('Create a read-only token →');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      'https://github.com/settings/personal-access-tokens/new?contents=read'
    );
  });

  test('"manage sets, public" shows a write create-token link with the configured storage owner as target_name', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'taljacob2',
      repo: 'swagger-editor-github',
      branch: 'aggregation-data',
    });
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.change(screen.getByLabelText('What do you want to do?'), {
      target: { value: 'manage-public' },
    });

    const link = screen.getByText('Create a write token →');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      'https://github.com/settings/personal-access-tokens/new?contents=write&target_name=taljacob2'
    );
  });

  test('"manage sets, private specs" shows both create-token links', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.change(screen.getByLabelText('What do you want to do?'), {
      target: { value: 'manage-private' },
    });

    expect(screen.getByText('Create a write token →')).toBeInTheDocument();
    expect(screen.getByText('Create a read-only token →')).toBeInTheDocument();
  });

  test('Connection appends a write-access note when the picker needs write and the token has it', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'taljacob2',
      repo: 'swagger-editor-github',
      branch: 'aggregation-data',
    });
    aggregationStorageService.canWriteToStorage.mockResolvedValue(true);
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.change(screen.getByLabelText('What do you want to do?'), {
      target: { value: 'manage-public' },
    });
    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Connected as taljacob2 — has write access to taljacob2/swagger-editor-github.'
        )
      ).toBeInTheDocument();
    });
  });

  test('Connection warns when the picker needs write but the token lacks it', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'taljacob2',
      repo: 'swagger-editor-github',
      branch: 'aggregation-data',
    });
    aggregationStorageService.canWriteToStorage.mockResolvedValue(false);
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.change(screen.getByLabelText('What do you want to do?'), {
      target: { value: 'manage-public' },
    });
    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Connected as taljacob2 — ⚠ no write access to taljacob2/swagger-editor-github; this token can't save sets."
        )
      ).toBeInTheDocument();
    });
  });

  test('Connection does not check write access when the picker is on a browse-only option', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'taljacob2',
      repo: 'swagger-editor-github',
      branch: 'aggregation-data',
    });
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(screen.getByText('Connected as taljacob2')).toBeInTheDocument();
    });
    expect(aggregationStorageService.canWriteToStorage).not.toHaveBeenCalled();
  });
});
