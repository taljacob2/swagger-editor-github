import React, { useState, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';

import {
  buildTokenCreationUrl,
  getConnectionSettings,
  saveConnectionSettings,
  testConnection,
} from '../github-connection-service.js';
import {
  canWriteToStorage,
  getStorageSettings,
} from '../../aggregation-storage/aggregation-storage-service.js';

const INTENTS = {
  BROWSE_PUBLIC: 'browse-public',
  BROWSE_PRIVATE: 'browse-private',
  MANAGE_PUBLIC: 'manage-public',
  MANAGE_PRIVATE: 'manage-private',
};

const NEEDS_WRITE = new Set([INTENTS.MANAGE_PUBLIC, INTENTS.MANAGE_PRIVATE]);
const SHOWS_REPO_TOKEN = new Set([
  INTENTS.BROWSE_PRIVATE,
  INTENTS.MANAGE_PUBLIC,
  INTENTS.MANAGE_PRIVATE,
]);

const PERMISSIONS_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/Permissions.md';

// Guesses which picker option to open with from whatever's already saved, so
// a returning user's existing token(s) aren't hidden behind the wrong
// selection -- a first-time user with nothing saved starts at "browse public"
// (both token fields hidden), matching the zero-config case.
function inferInitialIntent({ token, fetchToken }) {
  if (fetchToken) {
    return INTENTS.MANAGE_PRIVATE;
  }
  if (token) {
    return INTENTS.MANAGE_PUBLIC;
  }
  return INTENTS.BROWSE_PUBLIC;
}

const GitHubMenuHandler = forwardRef(({ getComponent }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [fetchToken, setFetchToken] = useState('');
  const [status, setStatus] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [intent, setIntent] = useState(INTENTS.BROWSE_PUBLIC);
  const [storage, setStorage] = useState({ owner: '', repo: '' });

  const Modal = getComponent('Modal');
  const ModalHeader = getComponent('ModalHeader');
  const ModalTitle = getComponent('ModalTitle');
  const ModalBody = getComponent('ModalBody');
  const ModalFooter = getComponent('ModalFooter');
  const Link = getComponent('Link');

  useImperativeHandle(ref, () => ({
    async openModal() {
      const settings = await getConnectionSettings();
      setApiBaseUrl(settings.apiBaseUrl);
      setToken(settings.token);
      setFetchToken(settings.fetchToken);
      setIntent(inferInitialIntent(settings));
      setStorage(getStorageSettings());
      setStatus(null);
      setIsOpen(true);
    },
  }));

  const handleClose = () => setIsOpen(false);

  const handleApiBaseUrlChange = (event) => setApiBaseUrl(event.target.value);
  const handleTokenChange = (event) => setToken(event.target.value);
  const handleFetchTokenChange = (event) => setFetchToken(event.target.value);
  const handleIntentChange = (event) => setIntent(event.target.value);

  const handleSaveClick = async () => {
    await saveConnectionSettings({ apiBaseUrl, token, fetchToken });
    setStatus({ ok: true, message: 'Saved.' });
  };

  const handleTestClick = async () => {
    setIsTesting(true);
    setStatus(null);
    let result = await testConnection({ apiBaseUrl, token });

    if (result.ok && NEEDS_WRITE.has(intent) && storage.owner && storage.repo) {
      const hasWriteAccess = await canWriteToStorage(storage, { apiBaseUrl, token });
      const repoLabel = `${storage.owner}/${storage.repo}`;
      result = {
        ...result,
        message:
          result.message +
          (hasWriteAccess
            ? ` — has write access to ${repoLabel}.`
            : ` — ⚠ no write access to ${repoLabel}; this token can't save sets.`),
      };
    }

    setStatus(result);
    setIsTesting(false);
  };

  // Named after the actual configured storage repo, not a hardcoded
  // "swagger-editor-github" -- this app may be forked or the repo renamed,
  // and storage.repo (defaulted from the deployed Pages URL, or explicitly
  // set under Aggregate -> Manage Sets -> Storage location) reflects that.
  const repoLabel =
    storage.owner && storage.repo ? `${storage.owner}/${storage.repo}` : 'this repo';
  const tokenName = storage.repo || 'swagger-editor-github';

  const readOnlyTokenUrl = buildTokenCreationUrl({
    apiBaseUrl,
    contents: 'read',
    name: `${tokenName} (read-only)`,
    description: `Read-only access for browsing/aggregating private specs (for use with ${tokenName})`,
  });
  const writeTokenUrl = buildTokenCreationUrl({
    apiBaseUrl,
    contents: 'write',
    targetName: storage.owner || undefined,
    name: `${tokenName} (repo token)`,
    description: `Write access for saving aggregation sets in ${repoLabel}`,
  });

  return (
    <Modal isOpen={isOpen} contentLabel="GitHub Connection Settings">
      <ModalHeader>
        <button type="button" className="close" onClick={handleClose}>
          <span aria-hidden="true">x</span>
        </button>
        <ModalTitle>GitHub Connection Settings</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <p>
          This app talks to GitHub directly from your browser — no server in between. Most people
          need less than they&apos;d expect, possibly no token at all. Pick what you&apos;re here to
          do and this will tell you exactly what (if anything) to paste below.
        </p>
        <div className="input-group">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="input-github-intent" aria-labelledby="input-github-intent">
            What do you want to do?
          </label>
          <select
            id="input-github-intent"
            className="form-control"
            value={intent}
            onChange={handleIntentChange}
          >
            <option value={INTENTS.BROWSE_PUBLIC}>Just browse or aggregate public specs</option>
            <option value={INTENTS.BROWSE_PRIVATE}>Browse or aggregate something private</option>
            <option value={INTENTS.MANAGE_PUBLIC}>
              Create, edit, or delete aggregation sets (everything public)
            </option>
            <option value={INTENTS.MANAGE_PRIVATE}>
              Create/edit/delete sets AND aggregate private specs
            </option>
          </select>

          {intent === INTENTS.BROWSE_PUBLIC && (
            <p className="help-block">
              Nothing to do — close this and get started. Everything works anonymously as long as
              what you&apos;re browsing/aggregating is public.
            </p>
          )}

          {intent !== INTENTS.BROWSE_PUBLIC && (
            <p className="help-block">
              See{' '}
              <Link href={PERMISSIONS_DOC_LINK} target="_blank">
                docs/Permissions.md
              </Link>{' '}
              for the full walkthrough and what each permission tier means.
            </p>
          )}
        </div>
        <div className="input-group">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="input-github-api-base-url" aria-labelledby="input-github-api-base-url">
            API base URL
          </label>
          <input
            id="input-github-api-base-url"
            type="text"
            className="form-control"
            placeholder="https://api.github.com"
            value={apiBaseUrl}
            onChange={handleApiBaseUrlChange}
          />
          <p className="help-block">
            {'https://api.github.com for github.com, or https://api.<your-domain> for a GitHub '}
            Enterprise Cloud custom domain.
          </p>
        </div>
        {SHOWS_REPO_TOKEN.has(intent) && (
          <div className="input-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="input-github-token" aria-labelledby="input-github-token">
              Repo token
            </label>
            <input
              id="input-github-token"
              type="password"
              className="form-control"
              placeholder="ghp_..."
              value={token}
              onChange={handleTokenChange}
            />
            <p className="help-block">
              Stored in this browser&apos;s local storage only, and sent only to the API base URL
              above.
            </p>
            {intent === INTENTS.BROWSE_PRIVATE && (
              <p className="help-block">
                Paste a <strong>read-only</strong> token here.{' '}
                {readOnlyTokenUrl && (
                  <Link href={readOnlyTokenUrl} target="_blank">
                    Create a read-only token →
                  </Link>
                )}{' '}
                On GitHub&apos;s page, switch <strong>Repository access</strong> to{' '}
                <strong>Only select repositories</strong> and pick whichever repo(s) you&apos;re
                reading.
              </p>
            )}
            {(intent === INTENTS.MANAGE_PUBLIC || intent === INTENTS.MANAGE_PRIVATE) && (
              <p className="help-block">
                Paste a <strong>write</strong> token here.{' '}
                {writeTokenUrl && (
                  <Link href={writeTokenUrl} target="_blank">
                    Create a write token →
                  </Link>
                )}{' '}
                On GitHub&apos;s page, switch <strong>Repository access</strong> to{' '}
                <strong>Only select repositories</strong> and pick <code>{repoLabel}</code>.
              </p>
            )}
          </div>
        )}
        {intent === INTENTS.MANAGE_PRIVATE && (
          <div className="input-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="input-github-fetch-token" aria-labelledby="input-github-fetch-token">
              Fetch token (optional — read-only, private repos)
            </label>
            <input
              id="input-github-fetch-token"
              type="password"
              className="form-control"
              placeholder="Leave blank to reuse the repo token above"
              value={fetchToken}
              onChange={handleFetchTokenChange}
            />
            <p className="help-block">
              Paste a <strong>read-only</strong> token here — used instead of widening the
              write-scoped Repo token above.{' '}
              {readOnlyTokenUrl && (
                <Link href={readOnlyTokenUrl} target="_blank">
                  Create a read-only token →
                </Link>
              )}{' '}
              On GitHub&apos;s page, switch <strong>Repository access</strong> to{' '}
              <strong>Only select repositories</strong> and pick whichever repo(s) you&apos;re
              reading.
            </p>
          </div>
        )}
        {status && <p className={status.ok ? 'text-success' : 'text-danger'}>{status.message}</p>}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleTestClick}
          disabled={isTesting}
        >
          {isTesting ? 'Testing…' : 'Test Connection'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSaveClick}>
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
});

GitHubMenuHandler.displayName = 'GitHubMenuHandler';

GitHubMenuHandler.propTypes = {
  getComponent: PropTypes.func.isRequired,
};

export default GitHubMenuHandler;
