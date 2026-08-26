import React, { useState, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';

import {
  buildClassicTokenCreationUrl,
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

const PERMISSIONS_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/Permissions.md';
const AUTH_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/GitHubAuthentication.md';

// Phrasing is deliberately parallel across all four -- "<what> — <public/private>"
// -- so the underlying 2x2 (browse/manage x public/private) reads directly off
// the labels instead of needing four independently-worded sentences.
//
// All three non-zero-config options need the exact same thing (one classic
// PAT with the repo scope) -- a classic token can't be split into read-only
// vs. write, or scoped to specific repos, the way a fine-grained one can (see
// buildClassicTokenCreationUrl's doc comment). These options still exist
// separately because they're useful framing for *whether* you need a token
// at all and *why*, even though the mechanical step below is now identical.
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
        description: 'Needs a classic personal access token.',
      },
    ],
  },
  {
    label: 'Creating & editing sets',
    options: [
      {
        value: INTENTS.MANAGE_PUBLIC,
        title: 'Create, edit, or delete sets — public specs only',
        description: 'Needs a classic personal access token.',
      },
      {
        value: INTENTS.MANAGE_PRIVATE,
        title: 'Create, edit, or delete sets — includes private specs',
        description: 'Needs a classic personal access token — same one as the other options.',
      },
    ],
  },
];

// Guesses which picker option to open with from whatever's already saved, so
// a returning user's existing token isn't hidden behind the wrong selection
// -- a first-time user with nothing saved starts at "browse public" (token
// field hidden), matching the zero-config case.
function inferInitialIntent({ token }) {
  if (token) {
    return INTENTS.MANAGE_PUBLIC;
  }
  return INTENTS.BROWSE_PUBLIC;
}

const GitHubMenuHandler = forwardRef(({ getComponent }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [token, setToken] = useState('');
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
      setIntent(inferInitialIntent(settings));
      setStorage(getStorageSettings());
      setStatus(null);
      setIsOpen(true);
    },
  }));

  const handleClose = () => setIsOpen(false);

  const handleApiBaseUrlChange = (event) => setApiBaseUrl(event.target.value);
  const handleTokenChange = (event) => setToken(event.target.value);
  const handleIntentChange = (event) => setIntent(event.target.value);

  const handleSaveClick = async () => {
    await saveConnectionSettings({ apiBaseUrl, token });
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
  const tokenName = storage.repo || 'swagger-editor-github';

  const classicTokenUrl = buildClassicTokenCreationUrl({
    apiBaseUrl,
    description: `Used by ${tokenName} to read/write on your behalf`,
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
        {intent !== INTENTS.BROWSE_PUBLIC && (
          <div className="input-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="input-github-token" aria-labelledby="input-github-token">
              GitHub token
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
            <p className="help-block">
              Paste a <strong>classic</strong> personal access token with the <code>repo</code>{' '}
              scope.{' '}
              {classicTokenUrl && (
                <Link href={classicTokenUrl} target="_blank">
                  Create a token →
                </Link>
              )}{' '}
              Fine-grained tokens aren&apos;t recommended here — see{' '}
              <Link href={PERMISSIONS_DOC_LINK} target="_blank">
                docs/Permissions.md
              </Link>{' '}
              for why.
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
