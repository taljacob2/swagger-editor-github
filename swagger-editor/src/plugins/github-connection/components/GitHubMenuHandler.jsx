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

const PERMISSIONS_DOC_LINK =
  'https://github.com/taljacob2/swagger-editor-github/blob/main/docs/Permissions.md';

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

  const readOnlyTokenUrl = buildTokenCreationUrl({
    apiBaseUrl,
    contents: 'read',
    name: 'swagger-editor-github (read-only)',
    description: 'Read-only access for browsing/aggregating in swagger-editor-github',
  });
  const writeTokenUrl = buildTokenCreationUrl({
    apiBaseUrl,
    contents: 'write',
    targetName: storage.owner || undefined,
    name: 'swagger-editor-github (repo token)',
    description: 'Write access for saving aggregation sets in swagger-editor-github',
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
              Nothing to do — leave both token fields below blank and close this. Everything works
              anonymously as long as what you&apos;re browsing/aggregating is public.
            </p>
          )}

          {intent === INTENTS.BROWSE_PRIVATE && (
            <p className="help-block">
              Paste a <strong>read-only</strong> token into <strong>Repo token</strong> below.{' '}
              {readOnlyTokenUrl && (
                <Link href={readOnlyTokenUrl} target="_blank">
                  Create a read-only token →
                </Link>
              )}
            </p>
          )}

          {intent === INTENTS.MANAGE_PUBLIC && (
            <p className="help-block">
              Paste a <strong>write</strong> token into <strong>Repo token</strong> below.{' '}
              {writeTokenUrl && (
                <Link href={writeTokenUrl} target="_blank">
                  Create a write token →
                </Link>
              )}
            </p>
          )}

          {intent === INTENTS.MANAGE_PRIVATE && (
            <p className="help-block">
              Paste a <strong>write</strong> token into <strong>Repo token</strong> below, and a{' '}
              <strong>read-only</strong> token into <strong>Fetch token</strong>.{' '}
              {writeTokenUrl && (
                <Link href={writeTokenUrl} target="_blank">
                  Create a write token →
                </Link>
              )}{' '}
              {readOnlyTokenUrl && (
                <Link href={readOnlyTokenUrl} target="_blank">
                  Create a read-only token →
                </Link>
              )}
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
            above. Leave blank if you picked &quot;Just browse or aggregate public specs&quot;
            above.
          </p>
        </div>
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
            Only needed for the &quot;create/edit/delete sets AND aggregate private specs&quot; case
            above — otherwise leave it blank.
          </p>
        </div>
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
