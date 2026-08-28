import React from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen } from '@testing-library/react';

import LinkTabModal from './LinkTabModal.jsx';
import * as githubConnectionService from '../../github-connection/github-connection-service.js';
import * as repoBrowserService from '../../github-repo-browser/github-repo-browser-service.js';
import * as linkedTargetService from '../linked-target-service.js';

vi.mock('../../github-connection/github-connection-service.js');
vi.mock('../../github-repo-browser/github-repo-browser-service.js');
vi.mock('../linked-target-service.js', () => ({ setLinkedTarget: vi.fn() }));

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

vi.mock('../../github-repo-browser/components/RepoBrowserModal.jsx', () => ({
  default: ({ isOpen, onFileSelected }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() =>
          onFileSelected({
            owner: 'octo-org',
            repo: 'petstore',
            path: 'openapi.yaml',
            ref: 'main',
            apiBaseUrl: 'https://api.github.com',
            content: 'openapi: 3.0.0\n',
          })
        }
      >
        Pick browsed file
      </button>
    ) : null,
}));

describe('LinkTabModal', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: 'test-token',
    });
  });

  test('renders nothing when closed', () => {
    render(<LinkTabModal getComponent={getComponent} isOpen={false} onClose={vi.fn()} tabId="a" />);

    expect(screen.queryByText('Link to repository file')).not.toBeInTheDocument();
  });

  test('pasting a recognizable GitHub URL fetches it fresh and links the tab', async () => {
    repoBrowserService.getFileContent.mockResolvedValue({ content: 'openapi: 3.0.0\n' });
    const onClose = vi.fn();
    render(<LinkTabModal getComponent={getComponent} isOpen onClose={onClose} tabId="a" />);

    fireEvent.change(screen.getByLabelText('GitHub file URL'), {
      target: { value: 'https://github.com/octo-org/petstore/blob/main/openapi.yaml' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Link'));
    });

    expect(repoBrowserService.getFileContent).toHaveBeenCalledWith(
      'octo-org',
      'petstore',
      'openapi.yaml',
      'main',
      expect.objectContaining({ apiBaseUrl: 'https://api.github.com' })
    );
    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        apiBaseUrl: 'https://api.github.com',
        owner: 'octo-org',
        repo: 'petstore',
        path: 'openapi.yaml',
        ref: 'main',
        baselineContent: 'openapi: 3.0.0\n',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  test('an unrecognizable URL surfaces an inline error and links nothing', async () => {
    render(<LinkTabModal getComponent={getComponent} isOpen onClose={vi.fn()} tabId="a" />);

    fireEvent.change(screen.getByLabelText('GitHub file URL'), {
      target: { value: 'https://example.com/not-github' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Link'));
    });

    expect(await screen.findByText(/Doesn't look like a GitHub file URL/)).toBeInTheDocument();
    expect(linkedTargetService.setLinkedTarget).not.toHaveBeenCalled();
  });

  test('a fetch failure for a recognized URL surfaces the error message', async () => {
    repoBrowserService.getFileContent.mockRejectedValue(new Error('GitHub API GET failed: 404'));
    render(<LinkTabModal getComponent={getComponent} isOpen onClose={vi.fn()} tabId="a" />);

    fireEvent.change(screen.getByLabelText('GitHub file URL'), {
      target: { value: 'https://github.com/octo-org/petstore/blob/main/openapi.yaml' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Link'));
    });

    expect(await screen.findByText('GitHub API GET failed: 404')).toBeInTheDocument();
    expect(linkedTargetService.setLinkedTarget).not.toHaveBeenCalled();
  });

  test('browsing GitHub and picking a file links the tab the same way', async () => {
    const onClose = vi.fn();
    render(<LinkTabModal getComponent={getComponent} isOpen onClose={onClose} tabId="a" />);

    fireEvent.click(screen.getByText('Browse GitHub repositories…'));
    await act(async () => {
      fireEvent.click(screen.getByText('Pick browsed file'));
    });

    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        owner: 'octo-org',
        repo: 'petstore',
        path: 'openapi.yaml',
        ref: 'main',
        baselineContent: 'openapi: 3.0.0\n',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });
});
