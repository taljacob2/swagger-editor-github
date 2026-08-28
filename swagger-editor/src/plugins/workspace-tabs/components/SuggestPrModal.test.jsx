import React from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import SuggestPrModal from './SuggestPrModal.jsx';
import * as githubConnectionService from '../../github-connection/github-connection-service.js';
import * as repoBrowserService from '../../github-repo-browser/github-repo-browser-service.js';
import * as suggestPrService from '../suggest-pr-service.js';
import * as linkedTargetService from '../linked-target-service.js';
import * as workspaceTabsService from '../workspace-tabs-service.js';

vi.mock('../../github-connection/github-connection-service.js');
vi.mock('../../github-repo-browser/github-repo-browser-service.js');
vi.mock('../suggest-pr-service.js');
vi.mock('../linked-target-service.js');
vi.mock('../workspace-tabs-service.js');

// diffLines is a pure function with its own dedicated coverage in
// suggest-pr-service.test.js -- importActual (rather than a hand-copied
// reimplementation) keeps that single real implementation as the source of
// truth for what the preview actually renders.
const { diffLines: realDiffLines } = await vi.importActual('../suggest-pr-service.js');

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

const TARGET = {
  apiBaseUrl: 'https://api.github.com',
  owner: 'octo-org',
  repo: 'petstore',
  path: 'openapi.yaml',
  ref: 'main',
  baselineContent: 'openapi: 3.0.0\ninfo:\n  title: X\n',
  baselineFetchedAt: '2026-01-01T00:00:00.000Z',
};

const editorActions = {
  convertContentToJSON: vi.fn(),
  convertContentToYAML: vi.fn(),
};

describe('SuggestPrModal', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue({
      apiBaseUrl: 'https://api.github.com',
      token: 'test-token',
    });
    linkedTargetService.getLinkedTarget.mockReturnValue(TARGET);
    linkedTargetService.setLinkedTarget.mockReturnValue(undefined);
    suggestPrService.canWriteToRepo.mockResolvedValue(true);
    suggestPrService.buildSuggestionBranchName.mockReturnValue('swagger-editor-suggestion-x');
    suggestPrService.createSuggestionBranch.mockResolvedValue(undefined);
    suggestPrService.createPullRequest.mockResolvedValue(
      'https://github.com/octo-org/petstore/pull/7'
    );
    suggestPrService.diffLines.mockImplementation(realDiffLines);
  });

  test('renders nothing when closed', () => {
    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen={false}
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(screen.queryByText('Suggest pull request')).not.toBeInTheDocument();
  });

  test('no drift, real changes: shows a preview and creates nothing until confirmed', async () => {
    repoBrowserService.getFileContent.mockResolvedValue({ content: TARGET.baselineContent });
    workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\ninfo:\n  title: Y\n');

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(await screen.findByText('Open pull request')).toBeInTheDocument();
    expect(screen.getByText(/Open a pull request updating/)).toBeInTheDocument();
    // The actual line-level diff: "title: X" removed, "title: Y" added.
    expect(screen.getByText('- title: X')).toBeInTheDocument();
    expect(screen.getByText('+ title: Y')).toBeInTheDocument();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();
    expect(suggestPrService.createPullRequest).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Open pull request'));
    });

    await waitFor(() =>
      expect(screen.getByText('https://github.com/octo-org/petstore/pull/7')).toBeInTheDocument()
    );
    expect(suggestPrService.createSuggestionBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octo-org',
        repo: 'petstore',
        baseRef: 'main',
        path: 'openapi.yaml',
        content: 'openapi: 3.0.0\ninfo:\n  title: Y\n',
        branchName: 'swagger-editor-suggestion-x',
      }),
      expect.objectContaining({ apiBaseUrl: 'https://api.github.com' })
    );
    expect(suggestPrService.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octo-org',
        repo: 'petstore',
        base: 'main',
        head: 'swagger-editor-suggestion-x',
      }),
      expect.objectContaining({ apiBaseUrl: 'https://api.github.com' })
    );
    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ baselineContent: 'openapi: 3.0.0\ninfo:\n  title: Y\n' })
    );
  });

  test('Cancel from the preview closes without creating anything', async () => {
    repoBrowserService.getFileContent.mockResolvedValue({ content: TARGET.baselineContent });
    workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\ninfo:\n  title: Y\n');
    const onClose = vi.fn();

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={onClose}
        tabId="a"
        editorActions={editorActions}
      />
    );

    await screen.findByText('Open pull request');
    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalled();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();
    expect(suggestPrService.createPullRequest).not.toHaveBeenCalled();
  });

  test('no changes to suggest when the tab matches the fresh upstream content', async () => {
    repoBrowserService.getFileContent.mockResolvedValue({ content: TARGET.baselineContent });
    workspaceTabsService.getTabContent.mockReturnValue(TARGET.baselineContent);

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(await screen.findByText(/No changes to suggest/)).toBeInTheDocument();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();
  });

  test('drift: warns and waits, then "Continue anyway" previews against the fresh content', async () => {
    const freshContent = 'openapi: 3.0.0\ninfo:\n  title: Changed upstream\n';
    repoBrowserService.getFileContent.mockResolvedValue({ content: freshContent });
    workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\ninfo:\n  title: My edit\n');

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(await screen.findByText(/changed since you started editing/)).toBeInTheDocument();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Continue anyway'));
    });

    // Lands on the preview, still without creating anything.
    expect(await screen.findByText('Open pull request')).toBeInTheDocument();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Open pull request'));
    });

    await waitFor(() => expect(suggestPrService.createSuggestionBranch).toHaveBeenCalled());
    expect(suggestPrService.createSuggestionBranch).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'openapi: 3.0.0\ninfo:\n  title: My edit\n' }),
      expect.anything()
    );
  });

  test('surfaces a no-write-access message and never attempts the branch/commit sequence', async () => {
    repoBrowserService.getFileContent.mockResolvedValue({ content: TARGET.baselineContent });
    workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\ninfo:\n  title: Y\n');
    suggestPrService.canWriteToRepo.mockResolvedValue(false);

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(await screen.findByText(/don't have write access/)).toBeInTheDocument();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();
  });

  test('converts JSON tab content to YAML when the target file is YAML, previewing the converted content', async () => {
    const jsonContent = '{\n  "openapi": "3.0.0"\n}';
    repoBrowserService.getFileContent.mockResolvedValue({ content: TARGET.baselineContent });
    workspaceTabsService.getTabContent.mockReturnValue(jsonContent);
    editorActions.convertContentToYAML.mockResolvedValue({
      error: false,
      payload: 'openapi: 3.0.0\n',
    });

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    await screen.findByText('Open pull request');
    expect(editorActions.convertContentToYAML).toHaveBeenCalledWith(jsonContent);
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Open pull request'));
    });

    await waitFor(() => expect(suggestPrService.createSuggestionBranch).toHaveBeenCalled());
    expect(suggestPrService.createSuggestionBranch).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'openapi: 3.0.0\n' }),
      expect.anything()
    );
  });

  test('a file too large to diff falls back to a plain message instead of a line-by-line preview', async () => {
    repoBrowserService.getFileContent.mockResolvedValue({ content: TARGET.baselineContent });
    workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\ninfo:\n  title: Y\n');
    suggestPrService.diffLines.mockReturnValue(null);

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(await screen.findByText(/too large to preview line-by-line/)).toBeInTheDocument();
  });

  test('surfaces an error when fetching the target fails', async () => {
    repoBrowserService.getFileContent.mockRejectedValue(new Error('GitHub API GET failed: 404'));

    render(
      <SuggestPrModal
        getComponent={getComponent}
        isOpen
        onClose={vi.fn()}
        tabId="a"
        editorActions={editorActions}
      />
    );

    expect(await screen.findByText('GitHub API GET failed: 404')).toBeInTheDocument();
  });
});
