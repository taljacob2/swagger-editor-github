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
// github-file-url.js is NOT mocked -- it's a pure URL parser with its own
// dedicated coverage, so tests below use real github.com URLs the real
// implementation actually recognizes rather than reimplementing its logic
// as a mock.

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

// diffLines/numberDiffLines/summarizeDrift are pure functions with their own
// dedicated coverage in suggest-pr-service.test.js -- importActual (rather
// than hand-copied reimplementations) keeps those real implementations as
// the source of truth for what the preview/drift phases actually render.
const {
  diffLines: realDiffLines,
  numberDiffLines: realNumberDiffLines,
  summarizeDrift: realSummarizeDrift,
} = await vi.importActual('../suggest-pr-service.js');

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
    suggestPrService.numberDiffLines.mockImplementation(realNumberDiffLines);
    suggestPrService.summarizeDrift.mockImplementation(realSummarizeDrift);
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
    expect(
      screen.getByText('title: X').closest('.swagger-editor__suggest-pr-diff-line')
    ).toHaveClass('swagger-editor__suggest-pr-diff-line--removed');
    expect(
      screen.getByText('title: Y').closest('.swagger-editor__suggest-pr-diff-line')
    ).toHaveClass('swagger-editor__suggest-pr-diff-line--added');
    // One line added, one removed -- the stat line above the diff.
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();
    expect(suggestPrService.createPullRequest).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Open pull request'));
    });

    await waitFor(() => expect(screen.getByText('Pull request opened.')).toBeInTheDocument());
    expect(screen.getByText('octo-org/petstore')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('#7').closest('a')).toHaveAttribute(
      'href',
      'https://github.com/octo-org/petstore/pull/7'
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
    // baselineContent must be pinned to what the base branch actually had
    // (freshContent) -- not the just-suggested content, which only exists
    // on the new branch until the PR is merged. Regression: this used to be
    // set to the suggestion itself, so the very next drift check compared
    // the real (unchanged) base branch against a baseline that had already
    // "moved on" to an unmerged PR, misreporting drift every time.
    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ baselineContent: TARGET.baselineContent })
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
    // The new baseline is the upstream content acknowledged via "Continue
    // anyway" (what the base branch actually has), not the suggestion.
    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ baselineContent: freshContent })
    );
  });

  test('"Continue anyway" repairs the stored baseline immediately, even if the PR is never created', async () => {
    // Regression: previously the baseline was only corrected as a side
    // effect of successfully creating another PR -- clicking "Continue
    // anyway" and then Cancel (never opening a PR) left the stale baseline
    // in place, so the exact same false-positive drift warning reappeared
    // on every subsequent attempt with no way to clear it.
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

    await screen.findByText(/changed since you started editing/);

    await act(async () => {
      fireEvent.click(screen.getByText('Continue anyway'));
    });

    expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ baselineContent: freshContent })
    );

    await screen.findByText('Open pull request');
    fireEvent.click(screen.getByText('Cancel'));

    expect(suggestPrService.createSuggestionBranch).not.toHaveBeenCalled();
    expect(suggestPrService.createPullRequest).not.toHaveBeenCalled();
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

  test('numbers diff lines per side -- context on both, removed/added on just their own', async () => {
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

    await screen.findByText('Open pull request');

    const removedLine = screen
      .getByText('title: X')
      .closest('.swagger-editor__suggest-pr-diff-line');
    const [removedOldNo, removedNewNo] = removedLine.querySelectorAll(
      '.swagger-editor__suggest-pr-diff-line-no'
    );
    expect(removedOldNo).toHaveTextContent('3');
    expect(removedNewNo).toHaveTextContent('');

    const addedLine = screen.getByText('title: Y').closest('.swagger-editor__suggest-pr-diff-line');
    const [addedOldNo, addedNewNo] = addedLine.querySelectorAll(
      '.swagger-editor__suggest-pr-diff-line-no'
    );
    expect(addedOldNo).toHaveTextContent('');
    expect(addedNewNo).toHaveTextContent('3');

    const firstContextLine = screen
      .getByText('openapi: 3.0.0')
      .closest('.swagger-editor__suggest-pr-diff-line');
    const [contextOldNo, contextNewNo] = firstContextLine.querySelectorAll(
      '.swagger-editor__suggest-pr-diff-line-no'
    );
    expect(contextOldNo).toHaveTextContent('1');
    expect(contextNewNo).toHaveTextContent('1');
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

  describe('showing what the tab is linked to', () => {
    test('shows it outside preview/success, and the footer button reaches back to linking', async () => {
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
      expect(screen.getByText('octo-org/petstore')).toBeInTheDocument();
      expect(screen.getByText('openapi.yaml')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Link to repository file'));

      expect(screen.getByLabelText('GitHub file URL')).toBeInTheDocument();
      // Re-linking shouldn't force typing the URL blind -- the currently
      // linked URL shows both as the empty input's placeholder (for anyone
      // who can read that far) and spelled out below it, since the input
      // itself is too narrow to show a long URL in full.
      expect(screen.getByLabelText('GitHub file URL')).toHaveAttribute(
        'placeholder',
        'https://github.com/octo-org/petstore/blob/main/openapi.yaml'
      );
      expect(
        screen.getByText('https://github.com/octo-org/petstore/blob/main/openapi.yaml')
      ).toBeInTheDocument();
    });

    test('the footer button stays available during preview, which also shows the target inline', async () => {
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

      await screen.findByText('Open pull request');

      fireEvent.click(screen.getByText('Link to repository file'));
      expect(screen.getByLabelText('GitHub file URL')).toBeInTheDocument();
    });

    test('is not shown once a pull request has been opened', async () => {
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

      await screen.findByText('Open pull request');
      await act(async () => {
        fireEvent.click(screen.getByText('Open pull request'));
      });
      await waitFor(() => expect(screen.getByText('Pull request opened.')).toBeInTheDocument());

      expect(screen.queryByText('Link to repository file')).not.toBeInTheDocument();
    });
  });

  // Linking has no modal of its own -- it's a phase of this same state
  // machine (see SuggestPrModal.jsx), entered automatically when the tab
  // isn't linked yet, or via the "Link to repository file" footer button
  // (covered above) to point an already-linked tab at a different file.
  describe('linking (no modal of its own)', () => {
    test('an unlinked tab opens straight into the linking form, not an error', async () => {
      linkedTargetService.getLinkedTarget.mockReturnValue(null);

      render(
        <SuggestPrModal
          getComponent={getComponent}
          isOpen
          onClose={vi.fn()}
          tabId="a"
          editorActions={editorActions}
        />
      );

      expect(await screen.findByLabelText('GitHub file URL')).toBeInTheDocument();
      expect(screen.queryByText(/no longer linked/)).not.toBeInTheDocument();
      // Nothing linked yet, so the placeholder falls back to a generic
      // example rather than an empty or broken reconstructed URL.
      expect(screen.getByLabelText('GitHub file URL')).toHaveAttribute(
        'placeholder',
        'https://github.com/owner/repo/blob/main/openapi.yaml'
      );
      expect(screen.queryByText(/Currently linked to/)).not.toBeInTheDocument();
    });

    test('pasting a recognizable GitHub URL links the tab and continues straight into the suggest flow', async () => {
      // run() re-reads getLinkedTarget(tabId) right after finishLinking's
      // setLinkedTarget call, so the mock needs to behave like real storage
      // (read back what was just written) rather than staying null forever.
      let storedTarget = null;
      linkedTargetService.getLinkedTarget.mockImplementation(() => storedTarget);
      linkedTargetService.setLinkedTarget.mockImplementation((_, target) => {
        storedTarget = target;
      });
      repoBrowserService.getFileContent.mockResolvedValue({ content: 'openapi: 3.0.0\n' });
      workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\n');
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

      fireEvent.change(await screen.findByLabelText('GitHub file URL'), {
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
      // Never closes -- it's the same modal, continuing straight into the
      // suggest flow on the content just fetched (no second network call).
      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByText(/No changes to suggest/)).toBeInTheDocument();
      expect(repoBrowserService.getFileContent).toHaveBeenCalledTimes(1);
    });

    test('an unrecognizable URL surfaces an inline error and links nothing', async () => {
      linkedTargetService.getLinkedTarget.mockReturnValue(null);

      render(
        <SuggestPrModal
          getComponent={getComponent}
          isOpen
          onClose={vi.fn()}
          tabId="a"
          editorActions={editorActions}
        />
      );

      fireEvent.change(await screen.findByLabelText('GitHub file URL'), {
        target: { value: 'https://example.com/not-github' },
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Link'));
      });

      expect(await screen.findByText(/Doesn't look like a GitHub file URL/)).toBeInTheDocument();
      expect(linkedTargetService.setLinkedTarget).not.toHaveBeenCalled();
    });

    test('a fetch failure for a recognized URL surfaces the error message', async () => {
      linkedTargetService.getLinkedTarget.mockReturnValue(null);
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

      fireEvent.change(await screen.findByLabelText('GitHub file URL'), {
        target: { value: 'https://github.com/octo-org/petstore/blob/main/openapi.yaml' },
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Link'));
      });

      expect(await screen.findByText('GitHub API GET failed: 404')).toBeInTheDocument();
      expect(linkedTargetService.setLinkedTarget).not.toHaveBeenCalled();
    });

    test('browsing GitHub and picking a file links the tab the same way', async () => {
      let storedTarget = null;
      linkedTargetService.getLinkedTarget.mockImplementation(() => storedTarget);
      linkedTargetService.setLinkedTarget.mockImplementation((_, target) => {
        storedTarget = target;
      });
      workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\n');
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

      fireEvent.click(await screen.findByText('Browse GitHub repositories…'));
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
      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByText(/No changes to suggest/)).toBeInTheDocument();
    });

    test('re-linking an already-linked tab via the footer button works the same way', async () => {
      // TARGET (from the default getLinkedTarget mock) stays linked; the
      // user just wants to point this tab at a different file.
      repoBrowserService.getFileContent
        .mockResolvedValueOnce({ content: TARGET.baselineContent }) // initial open
        .mockResolvedValueOnce({ content: 'openapi: 3.0.0\n' }); // re-link fetch
      workspaceTabsService.getTabContent.mockReturnValue('openapi: 3.0.0\n');

      render(
        <SuggestPrModal
          getComponent={getComponent}
          isOpen
          onClose={vi.fn()}
          tabId="a"
          editorActions={editorActions}
        />
      );

      await screen.findByText(/Linked to/);
      fireEvent.click(screen.getByText('Link to repository file'));

      fireEvent.change(await screen.findByLabelText('GitHub file URL'), {
        target: { value: 'https://github.com/octo-org/new-repo/blob/main/openapi.yaml' },
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Link'));
      });

      expect(linkedTargetService.setLinkedTarget).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ owner: 'octo-org', repo: 'new-repo' })
      );
    });
  });
});
