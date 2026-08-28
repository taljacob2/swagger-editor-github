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
      fetchToken: '',
    });
    githubConnectionService.saveConnectionSettings.mockImplementation(async (settings) => settings);
    githubConnectionService.testConnection.mockResolvedValue({
      ok: true,
      message: 'Connected as taljacob2',
    });
    githubConnectionService.buildClassicTokenCreationUrl.mockImplementation(
      () => 'https://github.com/settings/tokens/new?scopes=repo'
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
    expect(screen.getByLabelText('GitHub token')).toHaveValue('stored-token');
  });

  test('Save persists edited fields via saveConnectionSettings', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    fireEvent.change(screen.getByLabelText('API base URL'), {
      target: { value: 'https://api.mycompany.ghe.com' },
    });
    fireEvent.change(screen.getByLabelText('GitHub token'), {
      target: { value: 'new-token' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(githubConnectionService.saveConnectionSettings).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.mycompany.ghe.com',
      token: 'new-token',
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  test('Save surfaces a warning when the token could not be encrypted', async () => {
    githubConnectionService.saveConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: 'new-token',
      tokenEncrypted: false,
    });
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(
      screen.getByText(
        'Saved (warning: could not encrypt the token in this browser — it is stored as plain text).'
      )
    ).toBeInTheDocument();
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

  test('with nothing saved, defaults to "public only" and hides the token field', async () => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: '',
      fetchToken: '',
    });
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    expect(
      screen.getByRole('radio', { name: /Browse or aggregate — public specs only/ })
    ).toBeChecked();
    expect(screen.getByText('Nothing to configure — works anonymously.')).toBeInTheDocument();
    expect(screen.queryByLabelText('GitHub token')).not.toBeInTheDocument();
  });

  test('with a token saved, defaults to "needs a token"', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);

    expect(
      screen.getByRole('radio', { name: /Private specs, or creating\/editing sets/ })
    ).toBeChecked();
    expect(screen.getByLabelText('GitHub token')).toBeInTheDocument();
  });

  test('picking "public only" hides the GitHub token field', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.click(screen.getByRole('radio', { name: /Browse or aggregate — public specs only/ }));

    expect(screen.queryByLabelText('GitHub token')).not.toBeInTheDocument();
  });

  test('picking "needs a token" shows the GitHub token field with a classic-token create link', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.click(
      screen.getByRole('radio', { name: /Private specs, or creating\/editing sets/ })
    );

    expect(screen.getByLabelText('GitHub token')).toBeInTheDocument();
    const link = screen.getByText('Create a token →');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      'https://github.com/settings/tokens/new?scopes=repo'
    );
  });

  test('token description reflects the actual configured storage repo, not a hardcoded name (fork/rename safe)', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'someoneelse',
      repo: 'my-forked-editor',
      branch: 'aggregation-data',
    });
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.click(
      screen.getByRole('radio', { name: /Private specs, or creating\/editing sets/ })
    );

    expect(githubConnectionService.buildClassicTokenCreationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Used by my-forked-editor to read/write on your behalf',
      })
    );
  });

  // Test Connection now checks write access whenever a token and a storage
  // location are both present -- there's no longer a "browsing" vs. "managing
  // sets" choice to gate it on, since both options need the identical token.
  test('Connection appends a write-access note whenever a token and storage location are present', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'taljacob2',
      repo: 'swagger-editor-github',
      branch: 'aggregation-data',
    });
    aggregationStorageService.canWriteToStorage.mockResolvedValue(true);
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Connected as taljacob2 — has write access to taljacob2/swagger-editor-github.'
        )
      ).toBeInTheDocument();
    });
  });

  test('Connection warns when the token lacks write access', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'taljacob2',
      repo: 'swagger-editor-github',
      branch: 'aggregation-data',
    });
    aggregationStorageService.canWriteToStorage.mockResolvedValue(false);
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    await openModal(ref);
    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Connected as taljacob2 — ⚠ no write access to taljacob2/swagger-editor-github; this token can't save sets."
        )
      ).toBeInTheDocument();
    });
  });

  test('Connection does not check write access when there is no token', async () => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: '',
      fetchToken: '',
    });
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

  test('Connection does not check write access when the storage location is unknown', async () => {
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: '',
      repo: '',
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
