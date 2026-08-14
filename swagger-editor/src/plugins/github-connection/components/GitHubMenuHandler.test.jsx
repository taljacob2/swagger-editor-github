import React, { createRef } from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import GitHubMenuHandler from './GitHubMenuHandler.jsx';
import * as githubConnectionService from '../github-connection-service.js';

vi.mock('../github-connection-service.js');

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
});
