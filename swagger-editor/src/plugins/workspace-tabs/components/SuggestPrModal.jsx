import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { XIcon } from '@primer/octicons-react';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import { getFileContent } from '../../github-repo-browser/github-repo-browser-service.js';
import {
  buildSuggestionBranchName,
  canWriteToRepo,
  createPullRequest,
  createSuggestionBranch,
  diffLines,
} from '../suggest-pr-service.js';
import { getLinkedTarget, setLinkedTarget } from '../linked-target-service.js';
import { getTabContent } from '../workspace-tabs-service.js';

const isJsonPath = (path) => /\.json$/i.test(path);
const looksLikeJson = (content) => /^\s*[[{]/.test(content);

// Best-effort, not a byte-for-byte diff engine -- js-yaml's own re-dump does
// not preserve comments/formatting either, so a fancier diff here would just
// dress up numbers this feature can't act on precisely anyway. Reports where
// the two texts first diverge and how their line counts compare, enough for
// a human to judge whether it's worth reviewing further before continuing.
function summarizeDrift(baseline, fresh) {
  const baseLines = baseline.split('\n');
  const freshLines = fresh.split('\n');
  const maxLen = Math.max(baseLines.length, freshLines.length);
  let firstDiffLine = 0;
  while (firstDiffLine < maxLen && baseLines[firstDiffLine] === freshLines[firstDiffLine]) {
    firstDiffLine += 1;
  }
  return {
    baseLineCount: baseLines.length,
    freshLineCount: freshLines.length,
    firstDiffLine: firstDiffLine + 1,
  };
}

// A simple running counter per side (old/new), not full unified-diff hunk
// math -- diffLines is a plain LCS line diff with no hunk headers to begin
// with, so there's nothing more precise to number against. A context line
// advances both counters (it exists on both sides); a removed line only the
// old one, an added line only the new one.
function numberDiffLines(diff) {
  let oldNo = 0;
  let newNo = 0;
  return diff.map((line) => {
    if (line.type === 'removed') {
      oldNo += 1;
      return { ...line, oldNo, newNo: null };
    }
    if (line.type === 'added') {
      newNo += 1;
      return { ...line, oldNo: null, newNo };
    }
    oldNo += 1;
    newNo += 1;
    return { ...line, oldNo, newNo };
  });
}

const emptyState = {
  phase: 'working',
  workingLabel: 'Checking for changes…',
  message: null,
  driftSummary: null,
  freshContent: null,
  target: null,
  targetConnection: null,
  contentToCommit: null,
  diff: null,
  prUrl: null,
};

// Fetches the linked target fresh, warns on drift, diffs against the tab's
// current content, converts format if needed, and shows a preview of the
// exact commit -- creating nothing yet. Only handleConfirmCreate (fired by
// the explicit "Open pull request" button below) actually writes anything
// to GitHub. Assumes a link already exists for tabId; the tab action that
// opens this modal is responsible for running the linking dialog first when
// it doesn't (see TabBar.jsx). Linking has no UI of its own elsewhere --
// onChangeLink is this modal's only way back to it, for a first-time link or
// to point an already-linked tab at a different file.
const SuggestPrModal = ({
  getComponent,
  isOpen,
  onClose,
  tabId = null,
  editorActions,
  onChangeLink = undefined,
}) => {
  const [state, setState] = useState(emptyState);

  const Modal = getComponent('Modal', true);
  const ModalHeader = getComponent('ModalHeader');
  const ModalTitle = getComponent('ModalTitle');
  const ModalBody = getComponent('ModalBody');
  const ModalFooter = getComponent('ModalFooter');

  const resetAndClose = () => {
    setState(emptyState);
    onClose();
  };

  const run = async ({ skipDriftCheck = false, baseContentOverride = null } = {}) => {
    setState((prev) => ({
      ...prev,
      phase: 'working',
      workingLabel: 'Checking for changes…',
      message: null,
    }));
    const target = getLinkedTarget(tabId);
    if (!target) {
      setState({ ...emptyState, phase: 'error', message: 'This tab is no longer linked.' });
      return;
    }
    // Set as soon as it's known, not only on the phases below that already
    // needed it for their own display -- the "Linked to…/Change…" line near
    // the top of the modal (see the JSX below) reads it on every phase.
    setState((prev) => ({ ...prev, target }));
    try {
      const connection = await getConnectionSettings();
      const targetConnection = { ...connection, apiBaseUrl: target.apiBaseUrl };

      // Never reuse baselineContent for the diff itself -- only for the
      // drift comparison below. The base used for the actual diff/commit is
      // always this fresh fetch.
      const freshContent =
        baseContentOverride ??
        (await getFileContent(target.owner, target.repo, target.path, target.ref, targetConnection))
          .content;

      if (!skipDriftCheck && freshContent !== target.baselineContent) {
        setState({
          ...emptyState,
          phase: 'drift',
          driftSummary: summarizeDrift(target.baselineContent, freshContent),
          target,
          freshContent,
        });
        return;
      }

      const currentContent = getTabContent(tabId);
      if (currentContent === freshContent) {
        setState({ ...emptyState, phase: 'nothing-to-suggest', target });
        return;
      }

      let contentToCommit = currentContent;
      const targetIsJson = isJsonPath(target.path);
      const currentIsJson = looksLikeJson(currentContent);
      if (currentIsJson && !targetIsJson) {
        const fsa = await editorActions.convertContentToYAML(currentContent);
        if (fsa.error) {
          throw new Error(fsa.meta.errorMessage);
        }
        contentToCommit = fsa.payload;
      } else if (!currentIsJson && targetIsJson) {
        const fsa = await editorActions.convertContentToJSON(currentContent);
        if (fsa.error) {
          throw new Error(fsa.meta.errorMessage);
        }
        contentToCommit = fsa.payload;
      }

      const hasWriteAccess = await canWriteToRepo(target.owner, target.repo, targetConnection);
      if (!hasWriteAccess) {
        setState({ ...emptyState, phase: 'no-access', target });
        return;
      }

      // Stop here and let the user review exactly what would be committed --
      // nothing is written to GitHub until they explicitly confirm below.
      setState({
        ...emptyState,
        phase: 'preview',
        target,
        targetConnection,
        freshContent,
        contentToCommit,
        diff: diffLines(freshContent, contentToCommit),
      });
    } catch (error) {
      setState({ ...emptyState, phase: 'error', message: error.message, target });
    }
  };

  useEffect(() => {
    if (isOpen) {
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tabId]);

  const handleContinueAfterDrift = () => {
    // Persisted immediately, independent of whatever happens next in this
    // run (the user may still cancel out of the preview without opening a
    // PR) -- "Continue anyway" is itself an acknowledgment of what upstream
    // actually has now, and without this the corrected baseline only ever
    // got saved as a side effect of successfully creating another PR. Leave
    // this warning unresolved (e.g. by closing the modal instead) and it
    // reappeared identically on every subsequent attempt, with no way to
    // clear it short of opening a PR you might not have wanted to open.
    setLinkedTarget(tabId, {
      ...state.target,
      baselineContent: state.freshContent,
      baselineFetchedAt: new Date().toISOString(),
    });
    run({ skipDriftCheck: true, baseContentOverride: state.freshContent });
  };

  const handleConfirmCreate = async () => {
    const { target, targetConnection, contentToCommit, freshContent } = state;
    setState((prev) => ({ ...prev, phase: 'working', workingLabel: 'Opening pull request…' }));
    try {
      const branchName = buildSuggestionBranchName();
      await createSuggestionBranch(
        {
          owner: target.owner,
          repo: target.repo,
          baseRef: target.ref,
          path: target.path,
          content: contentToCommit,
          branchName,
          commitMessage: `Update ${target.path} via Swagger Editor`,
        },
        targetConnection
      );
      const prUrl = await createPullRequest(
        {
          owner: target.owner,
          repo: target.repo,
          title: `Update ${target.path}`,
          body: 'Suggested from a tab in Swagger Editor.',
          base: target.ref,
          head: branchName,
        },
        targetConnection
      );

      // baselineContent tracks the base branch's actual content, not the
      // suggestion -- the suggested content only exists on the new branch
      // until the PR is merged, so treating it as the new baseline would
      // make the very next drift check compare against content main doesn't
      // have yet, misreporting a huge "drift" for a PR that just hasn't
      // merged. freshContent is what the base branch genuinely had at the
      // moment this PR was opened, which is still correct until it merges.
      setLinkedTarget(tabId, {
        ...target,
        baselineContent: freshContent,
        baselineFetchedAt: new Date().toISOString(),
      });

      setState({ ...emptyState, phase: 'success', prUrl });
    } catch (error) {
      setState({ ...emptyState, phase: 'error', message: error.message, target });
    }
  };

  return (
    <Modal isOpen={isOpen} contentLabel="Suggest pull request" onRequestClose={resetAndClose}>
      <ModalHeader>
        <button type="button" className="close" onClick={resetAndClose}>
          <XIcon size={16} aria-hidden="true" />
        </button>
        <ModalTitle>Suggest pull request</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {/* Linking has no persistent UI of its own elsewhere in the tab bar
            -- this is the only place it's ever reachable from, both for a
            first-time link (below, when there isn't one yet) and to repoint
            an already-linked tab at a different file. Hidden on 'preview'
            and 'success', which already show the target inline. */}
        {state.target && state.phase !== 'preview' && state.phase !== 'success' && (
          <p className="swagger-editor__suggest-pr-target">
            Linked to{' '}
            <code>
              {state.target.owner}/{state.target.repo}
            </code>
            &apos;s <code>{state.target.path}</code>.{' '}
            <button
              type="button"
              className="swagger-editor__link-button"
              onClick={() => onChangeLink?.()}
            >
              Change…
            </button>
          </p>
        )}

        {state.phase === 'error' && !state.target && (
          <p className="swagger-editor__suggest-pr-target">
            <button
              type="button"
              className="swagger-editor__link-button"
              onClick={() => onChangeLink?.()}
            >
              Link this tab to a repository file…
            </button>
          </p>
        )}

        {state.phase === 'working' && <p className="help-block">{state.workingLabel}</p>}

        {state.phase === 'drift' && state.driftSummary && (
          <>
            <p className="text-danger">
              This file changed since you started editing — review before we open a PR.
            </p>
            <p className="help-block">
              First difference at line {state.driftSummary.firstDiffLine} (
              {state.driftSummary.baseLineCount} lines you started from vs.{' '}
              {state.driftSummary.freshLineCount} lines upstream now).
            </p>
          </>
        )}

        {state.phase === 'nothing-to-suggest' && (
          <p className="help-block">
            No changes to suggest — this tab matches the linked file already.
          </p>
        )}

        {state.phase === 'no-access' && (
          <p className="text-danger">
            You don&apos;t have write access to this repo — see docs/Permissions.md for how to get a
            token that can open pull requests.
          </p>
        )}

        {state.phase === 'error' && <p className="text-danger">{state.message}</p>}

        {state.phase === 'preview' && state.target && (
          <>
            <p className="swagger-editor__suggest-pr-summary">
              Open a pull request updating{' '}
              <code>
                {state.target.owner}/{state.target.repo}
              </code>
              &apos;s <code>{state.target.path}</code> (base branch <code>{state.target.ref}</code>)
              with this change?
            </p>
            {state.diff ? (
              <>
                <p className="swagger-editor__suggest-pr-diffstat">
                  <span className="swagger-editor__suggest-pr-diffstat-added">
                    +{state.diff.filter((line) => line.type === 'added').length}
                  </span>{' '}
                  <span className="swagger-editor__suggest-pr-diffstat-removed">
                    -{state.diff.filter((line) => line.type === 'removed').length}
                  </span>
                </p>
                <pre className="swagger-editor__suggest-pr-diff">
                  {/* Diff lines have no stable identity of their own -- index
                      is fine since this list is never reordered, only
                      replaced whole. */}
                  {numberDiffLines(state.diff).map((line, index) => (
                    <div
                      // eslint-disable-next-line react/no-array-index-key
                      key={index}
                      className={`swagger-editor__suggest-pr-diff-line swagger-editor__suggest-pr-diff-line--${line.type}`}
                    >
                      <span className="swagger-editor__suggest-pr-diff-line-no">
                        {line.oldNo ?? ''}
                      </span>
                      <span className="swagger-editor__suggest-pr-diff-line-no">
                        {line.newNo ?? ''}
                      </span>
                      <span className="swagger-editor__suggest-pr-diff-line-marker">
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                      </span>
                      <span className="swagger-editor__suggest-pr-diff-line-text">{line.text}</span>
                    </div>
                  ))}
                </pre>
              </>
            ) : (
              <p className="help-block">
                This file is too large to preview line-by-line here, but the change will be
                committed to <code>{state.target.path}</code> as shown above.
              </p>
            )}
          </>
        )}

        {state.phase === 'success' && state.prUrl && (
          <p className="text-success">
            Opened{' '}
            <a href={state.prUrl} target="_blank" rel="noreferrer">
              {state.prUrl}
            </a>
            .
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        {state.phase === 'drift' && (
          <button type="button" className="btn btn-primary" onClick={handleContinueAfterDrift}>
            Continue anyway
          </button>
        )}
        {state.phase === 'preview' && (
          <button type="button" className="btn btn-primary" onClick={handleConfirmCreate}>
            Open pull request
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
          {state.phase === 'success' ? 'Close' : 'Cancel'}
        </button>
      </ModalFooter>
    </Modal>
  );
};

SuggestPrModal.propTypes = {
  getComponent: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tabId: PropTypes.string,
  editorActions: PropTypes.shape({
    convertContentToJSON: PropTypes.func.isRequired,
    convertContentToYAML: PropTypes.func.isRequired,
  }).isRequired,
  onChangeLink: PropTypes.func,
};

export default SuggestPrModal;
