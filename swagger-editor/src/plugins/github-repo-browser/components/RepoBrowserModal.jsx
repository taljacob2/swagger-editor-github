import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { XIcon } from '@primer/octicons-react';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import {
  getFileContent,
  listBranches,
  listRepos,
  listSpecFiles,
} from '../github-repo-browser-service.js';

const STEPS = { REPOS: 'repos', BRANCHES: 'branches', FILES: 'files' };

const emptyState = {
  step: STEPS.REPOS,
  isLoading: false,
  error: null,
  connection: null,
  repos: null,
  repoFilter: '',
  selectedRepo: null,
  branches: null,
  branchFilter: '',
  selectedBranch: null,
  files: null,
};

// Shared "browse GitHub, pick a spec file" modal, used both from the Import
// menu and the Aggregation Settings modal -- each integration point decides
// what to do with the selection via onFileSelected, this component only
// knows how to get from "no idea what I want" to one chosen file.
const RepoBrowserModal = ({ getComponent, isOpen, onClose, onFileSelected }) => {
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

  const loadRepos = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const connection = await getConnectionSettings();
      // GET /user/repos only means something for an authenticated user --
      // without a token it's billed against the requesting IP's 60/hour
      // anonymous quota (shared by everyone on that IP), which is easy to
      // exhaust and comes back as a confusing "rate limit exceeded for
      // <ip>" rather than a clear "you need to sign in". Catch that case
      // before spending a request on a call that can't succeed anyway.
      if (!connection.token) {
        setState((prev) => ({
          ...prev,
          connection,
          isLoading: false,
          error:
            'Add a GitHub token in Connection Settings first — listing your repositories needs one.',
        }));
        return;
      }
      const repos = await listRepos(connection);
      setState((prev) => ({ ...prev, connection, repos, isLoading: false }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message, isLoading: false }));
    }
  };

  // Fetches on open (not on mount) so a modal that's rendered but not open
  // yet never hits the network, and a reopen always starts from a fresh list.
  // Gated on !state.error too -- loadRepos's failure path clears isLoading
  // without ever setting repos, so without this guard a failed fetch (e.g.
  // a 429) left repos === null and isLoading === false exactly as before the
  // attempt, and this effect would immediately re-fire and retry forever,
  // hammering the endpoint into a worse rate limit. A real retry now needs
  // an explicit click (see handleRetryClick below).
  useEffect(() => {
    if (
      isOpen &&
      state.step === STEPS.REPOS &&
      state.repos === null &&
      !state.isLoading &&
      !state.error
    ) {
      loadRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, state.step, state.repos, state.isLoading, state.error]);

  const handleRetryClick = () => loadRepos();

  const handleSelectRepo = async (repo) => {
    const [owner, name] = repo.full_name.split('/');
    setState((prev) => ({
      ...prev,
      step: STEPS.BRANCHES,
      isLoading: true,
      error: null,
      selectedRepo: { owner, name, defaultBranch: repo.default_branch },
    }));
    try {
      const branches = await listBranches(owner, name, state.connection);
      setState((prev) => ({
        ...prev,
        branches,
        selectedBranch: repo.default_branch,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message, isLoading: false }));
    }
  };

  const handleContinueToFiles = async () => {
    const { owner, name } = state.selectedRepo;
    setState((prev) => ({ ...prev, step: STEPS.FILES, isLoading: true, error: null }));
    try {
      const files = await listSpecFiles(owner, name, state.selectedBranch, state.connection);
      setState((prev) => ({ ...prev, files, isLoading: false }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message, isLoading: false }));
    }
  };

  const handleSelectFile = async (file) => {
    const { owner, name } = state.selectedRepo;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { content } = await getFileContent(owner, name, file.path, file.ref, state.connection);
      // Awaited so a caller (e.g. Aggregation Settings' own YAML/JSON
      // validation) can reject the selection by throwing -- caught below and
      // shown inline, leaving the modal open on the file list instead of
      // silently closing over a broken selection.
      await onFileSelected({
        owner,
        repo: name,
        path: file.path,
        ref: file.ref,
        apiBaseUrl: state.connection.apiBaseUrl,
        content,
      });
      resetAndClose();
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message, isLoading: false }));
    }
  };

  const handleBack = () => {
    if (state.step === STEPS.FILES) {
      setState((prev) => ({ ...prev, step: STEPS.BRANCHES, files: null, error: null }));
    } else if (state.step === STEPS.BRANCHES) {
      setState((prev) => ({
        ...prev,
        step: STEPS.REPOS,
        branches: null,
        selectedRepo: null,
        error: null,
      }));
    }
  };

  const filteredRepos = (state.repos || []).filter((repo) =>
    repo.full_name.toLowerCase().includes(state.repoFilter.toLowerCase())
  );
  const filteredBranches = (state.branches || []).filter((branch) =>
    branch.name.toLowerCase().includes(state.branchFilter.toLowerCase())
  );

  return (
    <Modal isOpen={isOpen} contentLabel="Browse GitHub repositories" onRequestClose={resetAndClose}>
      <ModalHeader>
        <button type="button" className="close" onClick={resetAndClose}>
          <XIcon size={16} aria-hidden="true" />
        </button>
        <ModalTitle>Browse GitHub repositories</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {state.error && (
          <div className="swagger-editor__repo-browser-alert swagger-editor__repo-browser-alert--error">
            <span className="swagger-editor__repo-browser-alert-message">{state.error}</span>
            {state.step === STEPS.REPOS && state.repos === null && (
              <button
                type="button"
                className="btn btn-secondary swagger-editor__repo-browser-alert-retry"
                onClick={handleRetryClick}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {state.step === STEPS.REPOS && (
          <>
            <input
              type="text"
              className="form-control swagger-editor__repo-browser-filter"
              placeholder="Filter repositories…"
              value={state.repoFilter}
              onChange={(e) => setState((prev) => ({ ...prev, repoFilter: e.target.value }))}
            />
            {state.isLoading && (
              <p className="swagger-editor__repo-browser-status">Loading repositories…</p>
            )}
            <ul className="swagger-editor__repo-browser-list">
              {filteredRepos.map((repo) => (
                <li key={repo.full_name}>
                  <button
                    type="button"
                    className="swagger-editor__repo-browser-row"
                    onClick={() => handleSelectRepo(repo)}
                  >
                    {repo.full_name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {state.step === STEPS.BRANCHES && (
          <>
            <p className="swagger-editor__repo-browser-step-heading">
              <code>
                {state.selectedRepo?.owner}/{state.selectedRepo?.name}
              </code>
            </p>
            <input
              type="text"
              className="form-control swagger-editor__repo-browser-filter"
              placeholder="Filter branches…"
              value={state.branchFilter}
              onChange={(e) => setState((prev) => ({ ...prev, branchFilter: e.target.value }))}
            />
            {state.isLoading && (
              <p className="swagger-editor__repo-browser-status">Loading branches…</p>
            )}
            <ul className="swagger-editor__repo-browser-list">
              {filteredBranches.map((branch) => (
                <li key={branch.name}>
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label className="swagger-editor__repo-browser-branch-row">
                    <input
                      type="radio"
                      name="repo-browser-branch"
                      checked={state.selectedBranch === branch.name}
                      onChange={() =>
                        setState((prev) => ({ ...prev, selectedBranch: branch.name }))
                      }
                    />
                    {branch.name}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {state.step === STEPS.FILES && (
          <>
            <p className="swagger-editor__repo-browser-step-heading">
              <code>
                {state.selectedRepo?.owner}/{state.selectedRepo?.name}@{state.selectedBranch}
              </code>
            </p>
            {state.isLoading && (
              <p className="swagger-editor__repo-browser-status">Searching for spec files…</p>
            )}
            {!state.isLoading && state.files?.length === 0 && (
              <p className="swagger-editor__repo-browser-status">
                No .yaml, .yml, or .json files found on this branch.
              </p>
            )}
            <ul className="swagger-editor__repo-browser-list">
              {(state.files || []).map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="swagger-editor__repo-browser-row"
                    onClick={() => handleSelectFile(file)}
                  >
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        {state.step !== STEPS.REPOS && (
          <button type="button" className="btn btn-secondary" onClick={handleBack}>
            Back
          </button>
        )}
        {state.step === STEPS.BRANCHES && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!state.selectedBranch}
            onClick={handleContinueToFiles}
          >
            Continue
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
          Cancel
        </button>
      </ModalFooter>
    </Modal>
  );
};

RepoBrowserModal.propTypes = {
  getComponent: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onFileSelected: PropTypes.func.isRequired,
};

export default RepoBrowserModal;
