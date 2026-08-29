import React from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import RepoBrowserModal from './RepoBrowserModal.jsx';
import * as githubConnectionService from '../../github-connection/github-connection-service.js';
import * as repoBrowserService from '../github-repo-browser-service.js';

vi.mock('../../github-connection/github-connection-service.js');
vi.mock('../github-repo-browser-service.js');

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

describe('RepoBrowserModal', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: 'test-token',
    });
    repoBrowserService.listRepos.mockResolvedValue([
      { full_name: 'owner/repo-a', default_branch: 'main' },
      { full_name: 'owner/repo-b', default_branch: 'trunk' },
    ]);
    repoBrowserService.listBranches.mockResolvedValue([{ name: 'main' }, { name: 'dev' }]);
    repoBrowserService.listSpecFiles.mockResolvedValue([{ path: 'openapi.yaml', ref: 'main' }]);
    repoBrowserService.getFileContent.mockResolvedValue({
      content: 'openapi: 3.0.0\n',
      sha: 'abc123',
    });
  });

  test('is not rendered when closed, and never fetches repos', () => {
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen={false}
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    expect(repoBrowserService.listRepos).not.toHaveBeenCalled();
    expect(screen.queryByText('Browse GitHub repositories')).not.toBeInTheDocument();
  });

  test('loads and lists repos on open, filterable by name', async () => {
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    expect(screen.getByText('owner/repo-b')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter repositories…'), {
      target: { value: 'repo-a' },
    });

    expect(screen.getByText('owner/repo-a')).toBeInTheDocument();
    expect(screen.queryByText('owner/repo-b')).not.toBeInTheDocument();
  });

  test('selecting a repo loads branches and preselects the default branch', async () => {
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    fireEvent.click(screen.getByText('owner/repo-a'));

    await waitFor(() =>
      expect(repoBrowserService.listBranches).toHaveBeenCalledWith(
        'owner',
        'repo-a',
        expect.objectContaining({ apiBaseUrl: 'https://api.github.com' })
      )
    );
    await waitFor(() => expect(screen.getByLabelText('main')).toBeChecked());
    expect(screen.getByLabelText('dev')).not.toBeChecked();
  });

  test('continuing to files walks the tree for the chosen branch and lists matches', async () => {
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    fireEvent.click(screen.getByText('owner/repo-a'));
    await waitFor(() => expect(screen.getByLabelText('main')).toBeChecked());

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() =>
      expect(repoBrowserService.listSpecFiles).toHaveBeenCalledWith(
        'owner',
        'repo-a',
        'main',
        expect.any(Object)
      )
    );
    expect(await screen.findByText('openapi.yaml')).toBeInTheDocument();
  });

  test('selecting a file fetches its content and calls onFileSelected, then closes', async () => {
    const onFileSelected = vi.fn();
    const onClose = vi.fn();
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={onClose}
        onFileSelected={onFileSelected}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    fireEvent.click(screen.getByText('owner/repo-a'));
    await waitFor(() => expect(screen.getByLabelText('main')).toBeChecked());
    fireEvent.click(screen.getByText('Continue'));
    const fileButton = await screen.findByText('openapi.yaml');

    await act(async () => {
      fireEvent.click(fileButton);
    });

    expect(onFileSelected).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo-a',
      path: 'openapi.yaml',
      ref: 'main',
      apiBaseUrl: 'https://api.github.com',
      content: 'openapi: 3.0.0\n',
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('a rejecting onFileSelected keeps the modal open and shows the error instead of closing', async () => {
    const onClose = vi.fn();
    const onFileSelected = vi.fn().mockRejectedValue(new Error("doesn't parse as valid YAML/JSON"));
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={onClose}
        onFileSelected={onFileSelected}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    fireEvent.click(screen.getByText('owner/repo-a'));
    await waitFor(() => expect(screen.getByLabelText('main')).toBeChecked());
    fireEvent.click(screen.getByText('Continue'));
    const fileButton = await screen.findByText('openapi.yaml');

    await act(async () => {
      fireEvent.click(fileButton);
    });

    expect(await screen.findByText("doesn't parse as valid YAML/JSON")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('openapi.yaml')).toBeInTheDocument();
  });

  test('Back returns from branches to the repo list', async () => {
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    fireEvent.click(screen.getByText('owner/repo-a'));
    await waitFor(() => expect(screen.getByLabelText('main')).toBeChecked());

    fireEvent.click(screen.getByText('Back'));

    expect(screen.getByText('owner/repo-a')).toBeInTheDocument();
    expect(screen.queryByLabelText('main')).not.toBeInTheDocument();
  });

  test('without a configured token, surfaces a clear message instead of calling listRepos', async () => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: '',
    });

    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    expect(
      await screen.findByText(
        'Add a GitHub token in Connection Settings first — listing your repositories needs one.'
      )
    ).toBeInTheDocument();
    expect(repoBrowserService.listRepos).not.toHaveBeenCalled();
  });

  test('surfaces a fetch failure as an inline error, without retrying on its own', async () => {
    repoBrowserService.listRepos.mockRejectedValue(new Error('GitHub API /user/repos failed: 429'));

    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    expect(await screen.findByText('GitHub API /user/repos failed: 429')).toBeInTheDocument();
    // Regression: a failed fetch used to leave repos===null and
    // isLoading===false exactly as before the attempt, so the fetch-on-open
    // effect re-fired immediately and looped forever, hammering the API
    // (this is what produced a flood of 429s in practice). Give any such
    // loop a few ticks to manifest, then confirm it only ever ran once.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(repoBrowserService.listRepos).toHaveBeenCalledTimes(1);
  });

  test('the step header shows where you are and fills in what you already chose', async () => {
    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    expect(screen.getByText('Repository')).toBeInTheDocument();
    expect(screen.getByText('Branch')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();

    fireEvent.click(screen.getByText('owner/repo-a'));
    await waitFor(() => expect(screen.getByLabelText('main')).toBeChecked());

    // Now past the Repository step -- its choice is filled in.
    expect(screen.getByText('owner/repo-a', { selector: 'code' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continue'));
    await screen.findByText('openapi.yaml');

    // Now past Branch too.
    expect(screen.getByText('main', { selector: 'code' })).toBeInTheDocument();
  });

  test('a private repo is badged; a public one carries no badge', async () => {
    repoBrowserService.listRepos.mockResolvedValue([
      { full_name: 'owner/private-repo', default_branch: 'main', private: true },
      { full_name: 'owner/public-repo', default_branch: 'main', private: false },
    ]);

    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('owner/private-repo')).toBeInTheDocument());
    const privateRow = screen.getByText('owner/private-repo').closest('button');
    const publicRow = screen.getByText('owner/public-repo').closest('button');

    expect(privateRow).toHaveTextContent('Private');
    expect(publicRow).not.toHaveTextContent('Private');
  });

  test('Retry re-attempts the fetch after a failure, and stops again on success', async () => {
    repoBrowserService.listRepos.mockRejectedValueOnce(
      new Error('GitHub API /user/repos failed: 429')
    );

    render(
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        onFileSelected={vi.fn()}
      />
    );

    await screen.findByText('GitHub API /user/repos failed: 429');

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });

    await waitFor(() => expect(screen.getByText('owner/repo-a')).toBeInTheDocument());
    expect(repoBrowserService.listRepos).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });
});
