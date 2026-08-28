import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { XIcon } from '@primer/octicons-react';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import parseGitHubFileUrl from '../../github-connection/github-file-url.js';
import RepoBrowserModal from '../../github-repo-browser/components/RepoBrowserModal.jsx';
import { getFileContent } from '../../github-repo-browser/github-repo-browser-service.js';
import { setLinkedTarget } from '../linked-target-service.js';

// The retroactive-linking case for a pasted/typed tab that never had a
// source URL to begin with -- offers both a pasted-URL shortcut (for a user
// who already has a blob/raw link in hand) and the same Repo Browser used
// elsewhere, since forcing everyone through the browse flow would be a step
// backwards for the "I already have the link" case.
const LinkTabModal = ({ getComponent, isOpen, onClose, tabId = null, onLinked = undefined }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);

  const Modal = getComponent('Modal', true);
  const ModalHeader = getComponent('ModalHeader');
  const ModalTitle = getComponent('ModalTitle');
  const ModalBody = getComponent('ModalBody');
  const ModalFooter = getComponent('ModalFooter');

  const resetAndClose = () => {
    setUrl('');
    setError(null);
    onClose();
  };

  // The baseline represents "the last known upstream state" -- for a
  // brand-new link that's simply the fresh fetch just made, whichever path
  // (pasted URL or browsed file) produced it.
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
    onLinked?.();
    resetAndClose();
  };

  const handleLinkFromUrlClick = async () => {
    setError(null);
    const connection = await getConnectionSettings();
    const parsed = parseGitHubFileUrl(url.trim(), connection.apiBaseUrl);
    if (!parsed) {
      setError(
        "Doesn't look like a GitHub file URL (a github.com/…/blob/… link, or a raw.githubusercontent.com link)."
      );
      return;
    }
    setIsLinking(true);
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
      setError(fetchError.message);
    } finally {
      setIsLinking(false);
    }
  };

  const handleFileSelectedFromBrowser = (selection) => finishLinking(selection);

  return (
    <>
      <Modal isOpen={isOpen} contentLabel="Link to repository file" onRequestClose={resetAndClose}>
        <ModalHeader>
          <button type="button" className="close" onClick={resetAndClose}>
            <XIcon size={16} aria-hidden="true" />
          </button>
          <ModalTitle>Link to repository file</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="help-block">
            Link this tab to a file in a GitHub repo so it can suggest a pull request back to it.
          </p>
          <div className="input-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="input-link-tab-url" aria-labelledby="input-link-tab-url">
              GitHub file URL
            </label>
            <input
              id="input-link-tab-url"
              type="text"
              className="form-control"
              placeholder="https://github.com/owner/repo/blob/main/openapi.yaml"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {error && <p className="text-danger">{error}</p>}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsBrowserOpen(true)}
          >
            Browse GitHub repositories…
          </button>
          <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!url.trim() || isLinking}
            onClick={handleLinkFromUrlClick}
          >
            {isLinking ? 'Linking…' : 'Link'}
          </button>
        </ModalFooter>
      </Modal>
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        onFileSelected={handleFileSelectedFromBrowser}
      />
    </>
  );
};

LinkTabModal.propTypes = {
  getComponent: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tabId: PropTypes.string,
  onLinked: PropTypes.func,
};

export default LinkTabModal;
