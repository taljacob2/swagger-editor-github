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
  PUBLIC_ONLY: 'public-only',
  NEEDS_TOKEN: 'needs-token',
};

const PERMISSIONS_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/Permissions.md';
const AUTH_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/GitHubAuthentication.md';

// Used to be four options (browse/manage x public/private), one per
// combination of "do I need a token" and "do I need write access". A classic
// PAT can't be split into read-only vs. write, or scoped to specific repos,
// the way the old fine-grained tokens could (see buildClassicTokenCreationUrl's
// doc comment) -- so three of those four rendered the identical field and
// link, and the only thing the choice still did was gate whether Test
// Connection also checked write access. Down to the one real question left:
// do you need a token at all. Test Connection now checks write access
// whenever a token and a storage location are both present, regardless of
// which option is picked here -- see handleTestClick.
const INTENT_OPTIONS = [
  {
    value: INTENTS.PUBLIC_ONLY,
    title: 'Browse or aggregate — public specs only',
    description: 'Nothing to configure — works anonymously.',
  },
  {
    value: INTENTS.NEEDS_TOKEN,
    title: 'Private specs, or creating/editing sets',
    description: 'Needs one classic personal access token.',
  },
];

// Guesses which picker option to open with from whatever's already saved, so
// a returning user's existing token isn't hidden behind the wrong selection
// -- a first-time user with nothing saved starts at "public only" (token
// field hidden), matching the zero-config case.
function inferInitialIntent({ token }) {
  if (token) {
    return INTENTS.NEEDS_TOKEN;
  }
  return INTENTS.PUBLIC_ONLY;
}

const GitHubMenuHandler = forwardRef(({ getComponent }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [intent, setIntent] = useState(INTENTS.PUBLIC_ONLY);
  const [storage, setStorage] = useState({ owner: '', repo: '' });

  const Modal = getComponent('Modal', true);
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

    if (result.ok && token && storage.owner && storage.repo) {
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
            {INTENT_OPTIONS.map((option) => (
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
        {intent !== INTENTS.PUBLIC_ONLY && (
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
