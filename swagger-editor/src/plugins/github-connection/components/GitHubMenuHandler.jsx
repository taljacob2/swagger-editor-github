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
const AUTH_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/GitHubAuthentication.md';

// Phrasing is deliberately parallel across all four -- "<what> — <public/private>"
// -- so the underlying 2x2 (browse/manage x public/private) reads directly off
// the labels instead of needing four independently-worded sentences.
const INTENT_GROUPS = [
  {
    label: 'Browsing',
    options: [
      {
        value: INTENTS.BROWSE_PUBLIC,
        title: 'Browse or aggregate — public specs only',
        description: 'Nothing to configure — works anonymously.',
      },
      {
        value: INTENTS.BROWSE_PRIVATE,
        title: 'Browse or aggregate — includes private specs',
        description: 'Needs one read-only token.',
      },
    ],
  },
  {
    label: 'Creating & editing sets',
    options: [
      {
        value: INTENTS.MANAGE_PUBLIC,
        title: 'Create, edit, or delete sets — public specs only',
        description: 'Needs one write token, scoped to this repo.',
      },
      {
        value: INTENTS.MANAGE_PRIVATE,
        title: 'Create, edit, or delete sets — includes private specs',
        description:
          'Needs a write token for this repo, plus a read-only token for the private specs.',
      },
    ],
  },
];

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
    <Modal isOpen={isOpen} contentLabel="GitHub Connection Settings" onRequestClose={handleClose}>
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
        <p className="help-block swagger-editor__auth-doc-hint">
          Why a token instead of a &quot;Sign in with GitHub&quot; button?{' '}
          <Link href={AUTH_DOC_LINK} target="_blank">
            docs/GitHubAuthentication.md
          </Link>
          .
        </p>
        <fieldset className="input-group swagger-editor__intent-picker">
          <legend className="swagger-editor__intent-picker-title">What do you want to do?</legend>

          <div className="swagger-editor__intent-grid">
            {INTENT_GROUPS.map((group) => (
              <React.Fragment key={group.label}>
                <div className="swagger-editor__intent-group-label">{group.label}</div>
                {group.options.map((option) => (
                  // eslint-disable-next-line jsx-a11y/label-has-associated-control
                  <label
                    key={option.value}
                    className={
                      intent === option.value
                        ? 'swagger-editor__intent-option swagger-editor__intent-option--selected'
                        : 'swagger-editor__intent-option'
                    }
                  >
                    <input
                      type="radio"
                      name="github-intent"
                      value={option.value}
                      checked={intent === option.value}
                      onChange={handleIntentChange}
                    />
                    <span className="swagger-editor__intent-option-text">
                      <span className="swagger-editor__intent-option-title">{option.title}</span>
                      <span className="swagger-editor__intent-option-description">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </React.Fragment>
            ))}
          </div>

          <p className="help-block">
            Full walkthrough of what each option needs and why:{' '}
            <Link href={PERMISSIONS_DOC_LINK} target="_blank">
              docs/Permissions.md
            </Link>
            .
          </p>
        </fieldset>
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
        {status && (
          <p className={status.ok ? 'text-success' : 'text-danger'}>
            {status.message}
            {status.ssoUrl && (
              <>
                {' '}
                <Link href={status.ssoUrl} target="_blank">
                  Authorize this token →
                </Link>
              </>
            )}
          </p>
        )}
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
