import React, { useState, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';

import {
  getConnectionSettings,
  saveConnectionSettings,
  testConnection,
} from '../github-connection-service.js';

const GitHubMenuHandler = forwardRef(({ getComponent }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  const Modal = getComponent('Modal');
  const ModalHeader = getComponent('ModalHeader');
  const ModalTitle = getComponent('ModalTitle');
  const ModalBody = getComponent('ModalBody');
  const ModalFooter = getComponent('ModalFooter');

  useImperativeHandle(ref, () => ({
    openModal() {
      const settings = getConnectionSettings();
      setApiBaseUrl(settings.apiBaseUrl);
      setToken(settings.token);
      setStatus(null);
      setIsOpen(true);
    },
  }));

  const handleClose = () => setIsOpen(false);

  const handleApiBaseUrlChange = (event) => setApiBaseUrl(event.target.value);
  const handleTokenChange = (event) => setToken(event.target.value);

  const handleSaveClick = () => {
    saveConnectionSettings({ apiBaseUrl, token });
    setStatus({ ok: true, message: 'Saved.' });
  };

  const handleTestClick = async () => {
    setIsTesting(true);
    setStatus(null);
    const result = await testConnection({ apiBaseUrl, token });
    setStatus(result);
    setIsTesting(false);
  };

  return (
    <Modal isOpen={isOpen} contentLabel="GitHub Connection Settings">
      <ModalHeader>
        <button type="button" className="close" onClick={handleClose}>
          <span aria-hidden="true">x</span>
        </button>
        <ModalTitle>GitHub Connection Settings</ModalTitle>
      </ModalHeader>
      <ModalBody>
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
            Personal access token
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
