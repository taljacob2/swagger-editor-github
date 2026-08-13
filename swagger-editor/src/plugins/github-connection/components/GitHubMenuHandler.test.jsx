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

const stubComponents = {
  Modal: StubModal,
  ModalHeader: StubPassthrough,
  ModalTitle: StubPassthrough,
  ModalBody: StubPassthrough,
  ModalFooter: StubPassthrough,
};

const getComponent = (name) => stubComponents[name];

describe('GitHubMenuHandler', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockReturnValue({
      apiBaseUrl: 'https://api.github.com',
      token: 'stored-token',
    });
    githubConnectionService.saveConnectionSettings.mockImplementation((settings) => settings);
    githubConnectionService.testConnection.mockResolvedValue({
      ok: true,
      message: 'Connected as taljacob2',
    });
  });

  test('is closed until openModal() is called via ref, then hydrates fields from stored settings', () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();

    act(() => {
      ref.current.openModal();
    });

    expect(githubConnectionService.getConnectionSettings).toHaveBeenCalled();
    expect(screen.getByLabelText('API base URL')).toHaveValue('https://api.github.com');
    expect(screen.getByLabelText('Personal access token')).toHaveValue('stored-token');
  });

  test('Save persists edited fields via saveConnectionSettings', () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    act(() => {
      ref.current.openModal();
    });

    fireEvent.change(screen.getByLabelText('API base URL'), {
      target: { value: 'https://api.mycompany.ghe.com' },
    });
    fireEvent.change(screen.getByLabelText('Personal access token'), {
      target: { value: 'new-token' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(githubConnectionService.saveConnectionSettings).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.mycompany.ghe.com',
      token: 'new-token',
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  test('Connection reports the result from testConnection', async () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    act(() => {
      ref.current.openModal();
    });

    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(screen.getByText('Connected as taljacob2')).toBeInTheDocument();
    });
    expect(githubConnectionService.testConnection).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.github.com',
      token: 'stored-token',
    });
  });

  test('Close hides the modal again', () => {
    const ref = createRef();
    render(<GitHubMenuHandler ref={ref} getComponent={getComponent} />);

    act(() => {
      ref.current.openModal();
    });
    expect(screen.getByLabelText('API base URL')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close'));

    expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
  });
});
