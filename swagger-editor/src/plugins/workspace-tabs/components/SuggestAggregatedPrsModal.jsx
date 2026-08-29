import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import YAML from 'js-yaml';
import {
  AlertFillIcon,
  CheckCircleFillIcon,
  GitPullRequestIcon,
  XIcon,
} from '@primer/octicons-react';

import { diffAggregatedSpecs } from '../../aggregation-storage/aggregation-diff-service.js';
import {
  getAggregationSet,
  getStorageSettings,
} from '../../aggregation-storage/aggregation-storage-service.js';
import { applySourcePatch } from '../../aggregation-storage/source-patch-service.js';
import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import { getFileContent } from '../../github-repo-browser/github-repo-browser-service.js';
import {
  buildSourcePatchOps,
  groupResolvedOpsBySource,
} from '../aggregated-pr-planning-service.js';
import {
  getAggregationProvenance,
  setAggregationProvenance,
} from '../aggregation-provenance-service.js';
import {
  buildSuggestionBranchName,
  canWriteToRepo,
  createPullRequest,
  createSuggestionBranch,
  diffLines,
  numberDiffLines,
  summarizeDrift,
} from '../suggest-pr-service.js';
import { getTabContent } from '../workspace-tabs-service.js';

// Human-readable text for why a change couldn't be included, keyed by the
// `reason` aggregation-diff-service.js and aggregated-pr-planning-service.js
// attach to each unresolved entry -- see those files for what produces each
// one. Never silently dropped: every reason here is shown to the user
// rather than just skipped, matching the drift-handling precedent Phase 1
// (SuggestPrModal.jsx) already set.
const UNRESOLVED_REASON_TEXT = {
  'entry-added': "it's new -- not present in the set the last time it was aggregated",
  'entry-removed': "it's gone from the merged view -- can't tell if that was a rename",
  'no-provenance': "couldn't be traced back to a source file",
  'source-not-linked': "its source isn't a recognized GitHub file",
  'source-entry-missing': 'no longer found in its source file',
  'source-name-ambiguous':
    "this set's saved routing has two services sharing a name -- re-run Aggregate on this set to fix it",
};

const SKIPPED_REASON_TEXT = {
  'fetch-failed': "couldn't be fetched",
  'no-access': "you don't have write access to this repo",
  error: 'ran into an unexpected error',
};

async function runSequentially(items, task) {
  const results = [];
  await items.reduce(
    (promise, item) =>
      promise.then(async () => {
        results.push(await task(item));
      }),
    Promise.resolve()
  );
  return results;
}

const emptyState = {
  phase: 'working',
  workingLabel: 'Checking for changes…',
  message: null,
  record: null,
  connection: null,
  bySource: null,
  freshBySource: null,
  driftedSources: [],
  unresolved: [],
  skipped: [],
  previews: [],
  results: [],
};

// The aggregated-view counterpart to SuggestPrModal.jsx -- a separate modal
// rather than a mode flag on it, since the phases genuinely differ (several
// sources, each with its own drift/diff, plus an unresolved-changes
// callout). Reuses suggest-pr-service.js's PR-opening primitives entirely
// unchanged; what's new here is tracing a change in the merged view back to
// the source file it belongs to (aggregated-pr-planning-service.js) and
// applying it there in a format-preserving way (source-patch-service.js).
// See the Phase 2 spec (docs/SuggestingPullRequests.md) for the full design.
const SuggestAggregatedPrsModal = ({ getComponent, isOpen, onClose, tabId = null }) => {
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

  // Fetches every touched source's current content in parallel -- a fetch
  // failure on one shouldn't block reviewing the rest, so it's folded into
  // `skipped` rather than aborting the whole run.
  const fetchFreshForSources = async (record, names, connection) => {
    const settled = await Promise.allSettled(
      names.map(async (name) => {
        const source = record.sources.find((candidate) => candidate.name === name);
        const targetConnection = { ...connection, apiBaseUrl: source.apiBaseUrl };
        const { content } = await getFileContent(
          source.owner,
          source.repo,
          source.path,
          source.ref,
          targetConnection
        );
        return content;
      })
    );
    const freshBySource = {};
    const fetchFailed = [];
    settled.forEach((result, index) => {
      const name = names[index];
      if (result.status === 'fulfilled') {
        freshBySource[name] = result.value;
      } else {
        fetchFailed.push({ name, reason: 'fetch-failed', message: result.reason.message });
      }
    });
    return { freshBySource, fetchFailed };
  };

  // Checks write access, resolves each source's ops against its own fresh
  // content, and builds the diff preview -- the last step before anything
  // is actually written to GitHub. Nothing here is skipped silently: a
  // source that fails any of these steps lands in `skipped`, and an
  // individual op that can't be resolved lands in `unresolved`.
  const buildPreviews = async (
    record,
    bySource,
    freshBySource,
    unresolvedIn,
    skippedIn,
    connection
  ) => {
    setState((prev) => ({ ...prev, phase: 'working', workingLabel: 'Preparing pull requests…' }));

    const names = [...bySource.keys()];
    const settled = await Promise.allSettled(
      names.map(async (name) => {
        const source = record.sources.find((candidate) => candidate.name === name);
        const freshContent = freshBySource[name];
        const targetConnection = { ...connection, apiBaseUrl: source.apiBaseUrl };
        const hasWriteAccess = await canWriteToRepo(source.owner, source.repo, targetConnection);
        if (!hasWriteAccess) {
          return { skipped: { name, reason: 'no-access' } };
        }
        const parsedFresh = YAML.load(freshContent);
        const { patchOps, unresolved: opUnresolved } = buildSourcePatchOps(
          bySource.get(name),
          parsedFresh
        );
        if (patchOps.length === 0) {
          return { unresolved: opUnresolved };
        }
        const contentToCommit = applySourcePatch(freshContent, patchOps);
        return {
          unresolved: opUnresolved,
          preview: {
            name,
            source,
            targetConnection,
            freshContent,
            contentToCommit,
            diff: diffLines(freshContent, contentToCommit),
          },
        };
      })
    );

    const unresolved = [...unresolvedIn];
    const skipped = [...skippedIn];
    const previews = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.skipped) skipped.push(result.value.skipped);
        if (result.value.unresolved) unresolved.push(...result.value.unresolved);
        if (result.value.preview) previews.push(result.value.preview);
      } else {
        skipped.push({ name: names[index], reason: 'error', message: result.reason.message });
      }
    });

    if (previews.length === 0) {
      setState({ ...emptyState, phase: 'nothing-to-suggest', record, unresolved, skipped });
      return;
    }

    setState({
      ...emptyState,
      phase: 'preview',
      record,
      connection,
      unresolved,
      skipped,
      previews,
    });
  };

  const run = async () => {
    setState({
      ...emptyState,
      phase: 'working',
      workingLabel: 'Checking for changes…',
    });
    const record = getAggregationProvenance(tabId);
    if (!record) {
      setState({
        ...emptyState,
        phase: 'error',
        message: "This tab's aggregation link is missing — re-run Aggregate to restore it.",
      });
      return;
    }
    try {
      const connection = await getConnectionSettings();

      // Editing the saved set (renaming/adding/removing a service) is a
      // set-level action that never reaches a tab this set was already
      // aggregated into -- the tab keeps whatever provenance record it got
      // at Aggregate time, the same way it keeps whatever merged text it
      // got (see the per-source drift check below for that half). A rename
      // is exactly how a name collision like the one groupResolvedOpsBySource
      // now guards against can go undetected in the record for a long time:
      // the Edit Set form's own duplicate check only runs at save time, so
      // renaming *away* from a collision fixes the set but leaves every tab
      // already aggregated from it still routing changes through the old,
      // colliding names. Comparing the set's current service names against
      // what this record has catches that -- and any other set edit -- up
      // front, before trusting the record for anything.
      if (record.setId) {
        const currentSet = await getAggregationSet(
          record.setId,
          getStorageSettings(),
          connection
        ).catch(() => null);
        if (currentSet) {
          const recordNames = record.sources.map((source) => source.name).sort();
          const currentNames = (currentSet.swaggerUrls || []).map((entry) => entry.name).sort();
          if (JSON.stringify(recordNames) !== JSON.stringify(currentNames)) {
            setState({ ...emptyState, phase: 'set-changed', record });
            return;
          }
        }
      }

      const baseline = YAML.load(record.baselineMergedText);
      const current = YAML.load(getTabContent(tabId));
      const { resolved, unresolved: diffUnresolved } = diffAggregatedSpecs(baseline, current);

      if (resolved.length === 0 && diffUnresolved.length === 0) {
        setState({
          ...emptyState,
          phase: 'nothing-to-suggest',
          record,
          unresolved: diffUnresolved,
        });
        return;
      }

      const { bySource, unresolved: groupingUnresolved } = groupResolvedOpsBySource(
        record,
        resolved
      );
      const unresolved = [...diffUnresolved, ...groupingUnresolved];

      if (bySource.size === 0) {
        setState({ ...emptyState, phase: 'nothing-to-suggest', record, unresolved });
        return;
      }

      const touchedNames = [...bySource.keys()];
      const { freshBySource, fetchFailed } = await fetchFreshForSources(
        record,
        touchedNames,
        connection
      );
      const skipped = [...fetchFailed];

      const driftedSources = touchedNames
        .filter((name) => freshBySource[name] !== undefined)
        .map((name) => {
          const source = record.sources.find((candidate) => candidate.name === name);
          const freshContent = freshBySource[name];
          return freshContent !== source.baselineContent
            ? { name, driftSummary: summarizeDrift(source.baselineContent, freshContent) }
            : null;
        })
        .filter(Boolean);

      if (driftedSources.length > 0) {
        setState({
          ...emptyState,
          phase: 'drift',
          record,
          bySource,
          unresolved,
          skipped,
          freshBySource,
          connection,
          driftedSources,
        });
        return;
      }

      await buildPreviews(record, bySource, freshBySource, unresolved, skipped, connection);
    } catch (error) {
      setState({ ...emptyState, phase: 'error', message: error.message, record });
    }
  };

  useEffect(() => {
    if (isOpen) {
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tabId]);

  const handleContinueAfterDrift = async () => {
    const { record, bySource, unresolved, skipped, freshBySource, connection, driftedSources } =
      state;
    // Persisted immediately, the same as SuggestPrModal.jsx's own
    // "Continue anyway" -- an explicit acknowledgment of what upstream has
    // now, so this warning doesn't reappear identically on the next attempt
    // for a source the user already reviewed.
    const driftedNames = new Set(driftedSources.map((d) => d.name));
    const updatedSources = record.sources.map((source) =>
      driftedNames.has(source.name)
        ? { ...source, baselineContent: freshBySource[source.name] }
        : source
    );
    const updatedRecord = { ...record, sources: updatedSources };
    setAggregationProvenance(tabId, updatedRecord);
    await buildPreviews(updatedRecord, bySource, freshBySource, unresolved, skipped, connection);
  };

  const handleConfirmCreate = async () => {
    const { record, previews } = state;
    setState((prev) => ({ ...prev, phase: 'working', workingLabel: 'Opening pull requests…' }));

    // Sequential, not Promise.all -- a failure partway through should still
    // produce a clear "opened N of M" result, not an ambiguous partial-
    // failure race (see the Phase 2 spec's §5.6).
    const results = await runSequentially(previews, async (preview) => {
      try {
        const branchName = buildSuggestionBranchName();
        await createSuggestionBranch(
          {
            owner: preview.source.owner,
            repo: preview.source.repo,
            baseRef: preview.source.ref,
            path: preview.source.path,
            content: preview.contentToCommit,
            branchName,
            commitMessage: `Update ${preview.source.path} via Swagger Editor`,
          },
          preview.targetConnection
        );
        const prUrl = await createPullRequest(
          {
            owner: preview.source.owner,
            repo: preview.source.repo,
            title: `Update ${preview.source.path}`,
            body: `Suggested from the aggregated view of "${record.setName}" in Swagger Editor.`,
            base: preview.source.ref,
            head: branchName,
          },
          preview.targetConnection
        );
        return {
          name: preview.name,
          ok: true,
          prUrl,
          owner: preview.source.owner,
          repo: preview.source.repo,
        };
      } catch (error) {
        return { name: preview.name, ok: false, message: error.message };
      }
    });

    // Same reasoning as SuggestPrModal.jsx: baselineContent tracks the base
    // branch's actual content, not the suggestion -- the suggested content
    // only exists on the new branch until the PR merges.
    const successfulNames = new Set(results.filter((r) => r.ok).map((r) => r.name));
    const updatedSources = record.sources.map((source) => {
      if (!successfulNames.has(source.name)) {
        return source;
      }
      const preview = previews.find((p) => p.name === source.name);
      return { ...source, baselineContent: preview.freshContent };
    });
    setAggregationProvenance(tabId, { ...record, sources: updatedSources });

    setState({ ...emptyState, phase: 'success', record, results });
  };

  const { record, unresolved, skipped } = state;
  const openPrLabel = state.previews.length > 1 ? 'Open pull requests' : 'Open pull request';

  return (
    <Modal isOpen={isOpen} contentLabel="Suggest pull requests" onRequestClose={resetAndClose}>
      <ModalHeader>
        <button type="button" className="close" onClick={resetAndClose}>
          <XIcon size={16} aria-hidden="true" />
        </button>
        <ModalTitle>Suggest pull requests</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {record && state.phase !== 'preview' && state.phase !== 'success' && (
          <p className="swagger-editor__suggest-pr-target">
            From the aggregated set <code>{record.setName}</code> ({record.sources.length} source
            {record.sources.length === 1 ? '' : 's'}).
          </p>
        )}

        {unresolved.length > 0 &&
          (state.phase === 'preview' || state.phase === 'nothing-to-suggest') && (
            <div className="swagger-editor__suggest-aggregated-pr-callout">
              <p className="swagger-editor__suggest-aggregated-pr-callout-title">
                <AlertFillIcon size={14} aria-hidden="true" />
                {unresolved.length} change{unresolved.length === 1 ? '' : 's'} won&apos;t be
                included
              </p>
              <ul className="swagger-editor__suggest-aggregated-pr-callout-list">
                {unresolved.map((item) => (
                  <li key={`${item.entryType}:${item.finalKey}`}>
                    <code>{item.finalKey}</code> —{' '}
                    {UNRESOLVED_REASON_TEXT[item.reason] || 'could not be included'}
                  </li>
                ))}
              </ul>
            </div>
          )}

        {skipped.length > 0 &&
          (state.phase === 'preview' || state.phase === 'nothing-to-suggest') && (
            <div className="swagger-editor__suggest-aggregated-pr-callout">
              <p className="swagger-editor__suggest-aggregated-pr-callout-title">
                <AlertFillIcon size={14} aria-hidden="true" />
                {skipped.length} source{skipped.length === 1 ? '' : 's'} skipped
              </p>
              <ul className="swagger-editor__suggest-aggregated-pr-callout-list">
                {skipped.map((item) => (
                  <li key={item.name}>
                    <strong>{item.name}</strong> —{' '}
                    {SKIPPED_REASON_TEXT[item.reason] || 'could not be processed'}
                    {item.message ? `: ${item.message}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

        {state.phase === 'working' && <p className="help-block">{state.workingLabel}</p>}

        {state.phase === 'error' && <p className="text-danger">{state.message}</p>}

        {state.phase === 'set-changed' && (
          <p className="text-danger">
            <code>{record.setName}</code> has been renamed, or had a service added or removed, since
            it was aggregated into this tab — this tab is still routing changes using the old
            service names. Re-run Aggregate on this set to update this tab, then try Suggest pull
            requests again.
          </p>
        )}

        {state.phase === 'nothing-to-suggest' && (
          <p className="help-block">
            No changes to suggest — the aggregated view either matches its sources already, or every
            change is shown above as not includable.
          </p>
        )}

        {state.phase === 'drift' && (
          <>
            <p className="text-danger">
              {state.driftedSources.length} source{state.driftedSources.length === 1 ? '' : 's'}{' '}
              changed since this set was last aggregated — review before we open any pull requests.
            </p>
            <ul className="swagger-editor__suggest-aggregated-pr-callout-list">
              {state.driftedSources.map((drifted) => (
                <li key={drifted.name}>
                  <strong>{drifted.name}</strong>: first difference at line{' '}
                  {drifted.driftSummary.firstDiffLine} ({drifted.driftSummary.baseLineCount} lines
                  you started from vs. {drifted.driftSummary.freshLineCount} lines upstream now).
                </li>
              ))}
            </ul>
          </>
        )}

        {state.phase === 'preview' &&
          state.previews.map((preview) => (
            <div key={preview.name} className="swagger-editor__suggest-aggregated-pr-source">
              <p className="swagger-editor__suggest-pr-summary">
                Update{' '}
                <code>
                  {preview.source.owner}/{preview.source.repo}
                </code>
                &apos;s <code>{preview.source.path}</code> (base branch{' '}
                <code>{preview.source.ref}</code>)
              </p>
              {preview.diff ? (
                <>
                  <p className="swagger-editor__suggest-pr-diffstat">
                    <span className="swagger-editor__suggest-pr-diffstat-added">
                      +{preview.diff.filter((line) => line.type === 'added').length}
                    </span>{' '}
                    <span className="swagger-editor__suggest-pr-diffstat-removed">
                      -{preview.diff.filter((line) => line.type === 'removed').length}
                    </span>
                  </p>
                  <pre className="swagger-editor__suggest-pr-diff">
                    {numberDiffLines(preview.diff).map((line, index) => (
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
                  committed to <code>{preview.source.path}</code> as shown above.
                </p>
              )}
            </div>
          ))}

        {state.phase === 'success' && (
          <div className="swagger-editor__suggest-pr-success">
            <p className="swagger-editor__suggest-pr-success-message">
              <CheckCircleFillIcon size={16} aria-hidden="true" />
              {state.results.filter((r) => r.ok).length} of {state.results.length} pull request
              {state.results.length === 1 ? '' : 's'} opened.
            </p>
            {state.results.map((result) =>
              result.ok ? (
                <a
                  key={result.name}
                  className="swagger-editor__suggest-pr-success-chip"
                  href={result.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitPullRequestIcon size={16} aria-hidden="true" />
                  <span>
                    {result.owner}/{result.repo}
                  </span>
                </a>
              ) : (
                <p key={result.name} className="text-danger">
                  <strong>{result.name}</strong>: {result.message}
                </p>
              )
            )}
          </div>
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
            {openPrLabel}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
          {state.phase === 'success' ? 'Close' : 'Cancel'}
        </button>
      </ModalFooter>
    </Modal>
  );
};

SuggestAggregatedPrsModal.propTypes = {
  getComponent: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tabId: PropTypes.string,
};

export default SuggestAggregatedPrsModal;
