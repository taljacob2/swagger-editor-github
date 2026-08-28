import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import {
  CheckCircleFillIcon,
  GitPullRequestIcon,
  LinkIcon,
  RepoIcon,
  XIcon,
} from '@primer/octicons-react';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import parseGitHubFileUrl, { buildGitHubFileUrl } from '../../github-connection/github-file-url.js';
import RepoBrowserModal from '../../github-repo-browser/components/RepoBrowserModal.jsx';
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
  // 'link' phase only -- a pasted-URL shortcut plus the same Repo Browser
  // used elsewhere, folded in here rather than a separate modal (see the
  // 'link' phase render below for why).
  linkUrl: '',
  linkError: null,
  isLinking: false,
  isBrowserOpen: false,
};

// Fetches the linked target fresh, warns on drift, diffs against the tab's
// current content, converts format if needed, and shows a preview of the
// exact commit -- creating nothing yet. Only handleConfirmCreate (fired by
// the explicit "Open pull request" button below) actually writes anything
// to GitHub. Linking has no modal of its own -- it's the 'link' phase of
// this same state machine, entered automatically when tabId has no link
// yet, or via the footer's "Link to repository file" button to point an
// already-linked tab at a different file. Keeping it one modal (rather than
// two swapped in and out by a parent) means there's no close-one/open-
// another transition for a stray click or a slow animation frame to land
// awkwardly in the middle of.
const SuggestPrModal = ({ getComponent, isOpen, onClose, tabId = null, editorActions }) => {
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
      // Reachable if the link was removed out from under an already-open
      // modal (e.g. the tab was closed elsewhere) -- offer to link again
      // directly rather than dead-ending on an error.
      setState({ ...emptyState, phase: 'link' });
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
      if (getLinkedTarget(tabId)) {
        run();
      } else {
        setState({ ...emptyState, phase: 'link' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tabId]);

  // The baseline represents "the last known upstream state" -- for a
  // brand-new link that's simply the fresh fetch just made, whichever path
  // (pasted URL or browsed file) produced it. Continues straight into run()
  // with that same content rather than closing/reopening anything or
  // re-fetching what was just fetched a moment ago.
  const finishLinking = ({ apiBaseUrl, owner, repo, path, ref, content }) => {
    setLinkedTarget(tabId, {
      apiBaseUrl,
      owner,
      repo,
      path,
      ref,
      baselineContent: content,
      baselineFetchedAt: new Date().toISOString(),
    });
    run({ skipDriftCheck: true, baseContentOverride: content });
  };

  const handleLinkFromUrlClick = async () => {
    setState((prev) => ({ ...prev, linkError: null }));
    const connection = await getConnectionSettings();
    const parsed = parseGitHubFileUrl(state.linkUrl.trim(), connection.apiBaseUrl);
    if (!parsed) {
      setState((prev) => ({
        ...prev,
        linkError:
          "Doesn't look like a GitHub file URL (a github.com/…/blob/… link, or a raw.githubusercontent.com link).",
      }));
      return;
    }
    setState((prev) => ({ ...prev, isLinking: true }));
    try {
      const { content } = await getFileContent(parsed.owner, parsed.repo, parsed.path, parsed.ref, {
        ...connection,
        apiBaseUrl: parsed.apiBase,
      });
      finishLinking({
        apiBaseUrl: parsed.apiBase,
        owner: parsed.owner,
        repo: parsed.repo,
        path: parsed.path,
        ref: parsed.ref,
        content,
      });
    } catch (fetchError) {
      setState((prev) => ({ ...prev, linkError: fetchError.message, isLinking: false }));
    }
  };

  const handleFileSelectedFromBrowser = (selection) => finishLinking(selection);

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

      setState({ ...emptyState, phase: 'success', prUrl, target });
    } catch (error) {
      setState({ ...emptyState, phase: 'error', message: error.message, target });
    }
  };

  // The number is the one piece of a GitHub PR URL worth pulling out on its
  // own for the success chip below -- everything else about the URL
  // (owner/repo) is already known from state.target, no need to reparse it.
  const prNumberMatch = state.prUrl?.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? prNumberMatch[1] : null;

  // Re-read directly from storage (not state.target, which the "Link to
  // repository file" button clears via emptyState) so a re-link still shows
  // what's already linked -- a quick way to check the current target before
  // deciding whether to replace it, without leaving the form.
  const existingLinkedTarget = state.phase === 'link' ? getLinkedTarget(tabId) : null;
  const existingLinkedUrl = existingLinkedTarget ? buildGitHubFileUrl(existingLinkedTarget) : null;

  return (
    <>
      <Modal isOpen={isOpen} contentLabel="Suggest pull request" onRequestClose={resetAndClose}>
        <ModalHeader>
          <button type="button" className="close" onClick={resetAndClose}>
            <XIcon size={16} aria-hidden="true" />
          </button>
          <ModalTitle>Suggest pull request</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {/* Linking has no persistent UI of its own elsewhere in the tab bar
            -- the footer's "Link to repository file" button below is the
            only place it's ever reachable from, both for a first-time link
            and to repoint an already-linked tab at a different file. This
            line is purely informational; hidden on 'preview' and 'success',
            which already show the target inline. */}
          {state.target && state.phase !== 'preview' && state.phase !== 'success' && (
            <p className="swagger-editor__suggest-pr-target">
              <RepoIcon size={14} aria-hidden="true" />
              Linked to{' '}
              <code>
                {state.target.owner}/{state.target.repo}
              </code>
              &apos;s <code>{state.target.path}</code>.
            </p>
          )}

          {state.phase === 'link' && (
            <>
              <p className="help-block">
                Link this tab to a file in a GitHub repo so it can suggest a pull request back to
                it.
              </p>
              <div className="input-group">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label
                  htmlFor="input-suggest-pr-link-url"
                  aria-labelledby="input-suggest-pr-link-url"
                >
                  GitHub file URL
                </label>
                <input
                  id="input-suggest-pr-link-url"
                  type="text"
                  className="form-control"
                  placeholder={
                    existingLinkedUrl || 'https://github.com/owner/repo/blob/main/openapi.yaml'
                  }
                  title={existingLinkedUrl || undefined}
                  value={state.linkUrl}
                  onChange={(e) => setState((prev) => ({ ...prev, linkUrl: e.target.value }))}
                />
              </div>
              {/* The input above is too narrow to show a long URL in full
                (as a placeholder or otherwise) -- spelled out here, in a
                spot that wraps instead of clipping, so re-linking still
                shows what's already linked without relying on a hover
                tooltip (the input's title attribute, for anyone who can). */}
              {existingLinkedUrl && (
                <p className="help-block swagger-editor__suggest-pr-existing-link">
                  Currently linked to <code>{existingLinkedUrl}</code>
                </p>
              )}
              {state.linkError && <p className="text-danger">{state.linkError}</p>}
            </>
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
              You don&apos;t have write access to this repo — see docs/Permissions.md for how to get
              a token that can open pull requests.
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
                &apos;s <code>{state.target.path}</code> (base branch{' '}
                <code>{state.target.ref}</code>) with this change?
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
                        <span className="swagger-editor__suggest-pr-diff-line-text">
                          {line.text}
                        </span>
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
            <div className="swagger-editor__suggest-pr-success">
              <p className="swagger-editor__suggest-pr-success-message">
                <CheckCircleFillIcon size={16} aria-hidden="true" />
                Pull request opened.
              </p>
              <a
                className="swagger-editor__suggest-pr-success-chip"
                href={state.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                <GitPullRequestIcon size={16} aria-hidden="true" />
                {state.target && (
                  <span>
                    {state.target.owner}/{state.target.repo}
                  </span>
                )}
                {prNumber && (
                  <span className="swagger-editor__suggest-pr-success-chip-number">
                    #{prNumber}
                  </span>
                )}
              </a>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {state.phase === 'link' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setState((prev) => ({ ...prev, isBrowserOpen: true }))}
            >
              Browse GitHub repositories…
            </button>
          )}
          {/* Always available except 'link' itself (already there) and
            'success' (the PR is already open; relinking has nothing left to
            do) -- linking has no button of its own anywhere else, so this is
            it, whether the tab isn't linked yet or the user wants to point
            it at a different file. */}
          {state.phase !== 'link' && state.phase !== 'success' && (
            <button
              type="button"
              className="btn btn-secondary swagger-editor__suggest-pr-relink-button"
              onClick={() => setState({ ...emptyState, phase: 'link' })}
            >
              <LinkIcon size={14} aria-hidden="true" />
              Link to repository file
            </button>
          )}
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
          {state.phase === 'link' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!state.linkUrl.trim() || state.isLinking}
              onClick={handleLinkFromUrlClick}
            >
              {state.isLinking ? 'Linking…' : 'Link'}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
            {state.phase === 'success' ? 'Close' : 'Cancel'}
          </button>
        </ModalFooter>
      </Modal>
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen={state.isBrowserOpen}
        onClose={() => setState((prev) => ({ ...prev, isBrowserOpen: false }))}
        onFileSelected={handleFileSelectedFromBrowser}
      />
    </>
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
};

export default SuggestPrModal;
