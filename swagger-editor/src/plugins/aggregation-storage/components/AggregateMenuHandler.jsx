import React, { useImperativeHandle, useState, forwardRef } from 'react';
import PropTypes from 'prop-types';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import {
  deleteAggregationSet,
  getStorageSettings,
  listAggregationSets,
  saveAggregationSet,
  saveStorageSettings,
} from '../aggregation-storage-service.js';

const emptyForm = { id: null, name: '', swaggerUrls: [] };

const AggregateMenuHandler = forwardRef(({ getComponent }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [sets, setSets] = useState([]);
  const [isLoadingSets, setIsLoadingSets] = useState(false);
  const [status, setStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newUrlName, setNewUrlName] = useState('');
  const [newUrlValue, setNewUrlValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const Modal = getComponent('Modal');
  const ModalHeader = getComponent('ModalHeader');
  const ModalTitle = getComponent('ModalTitle');
  const ModalBody = getComponent('ModalBody');
  const ModalFooter = getComponent('ModalFooter');
  const ConfirmDialog = getComponent('ConfirmDialog', true);

  const currentStorage = () => ({ owner, repo, branch });

  const refreshSets = async (storage) => {
    if (!storage.owner || !storage.repo) {
      setSets([]);
      return;
    }
    setIsLoadingSets(true);
    try {
      const result = await listAggregationSets(storage, getConnectionSettings());
      setSets(result);
    } catch (error) {
      setStatus({ ok: false, message: error.message });
    } finally {
      setIsLoadingSets(false);
    }
  };

  useImperativeHandle(ref, () => ({
    openModal() {
      const settings = getStorageSettings();
      setOwner(settings.owner);
      setRepo(settings.repo);
      setBranch(settings.branch);
      setStatus(null);
      setShowForm(false);
      setIsOpen(true);
      refreshSets(settings);
    },
  }));

  const handleClose = () => setIsOpen(false);

  const handleSaveLocationClick = () => {
    const settings = saveStorageSettings({ owner, repo, branch });
    setOwner(settings.owner);
    setRepo(settings.repo);
    setBranch(settings.branch);
    setStatus({ ok: true, message: 'Storage location saved.' });
    refreshSets(settings);
  };

  const handleNewSetClick = () => {
    setForm(emptyForm);
    setNewUrlName('');
    setNewUrlValue('');
    setShowForm(true);
  };

  const handleEditSetClick = (set) => {
    setForm({ id: set.id, name: set.name, swaggerUrls: set.swaggerUrls || [] });
    setNewUrlName('');
    setNewUrlValue('');
    setShowForm(true);
  };

  const handleCancelFormClick = () => setShowForm(false);

  const handleAddUrlClick = () => {
    if (!newUrlValue.trim()) {
      return;
    }
    const entry = {
      name: newUrlName.trim() || `Service ${form.swaggerUrls.length + 1}`,
      url: newUrlValue.trim(),
    };
    setForm((prev) => ({ ...prev, swaggerUrls: [...prev.swaggerUrls, entry] }));
    setNewUrlName('');
    setNewUrlValue('');
  };

  const handleRemoveUrlClick = (index) => {
    setForm((prev) => ({
      ...prev,
      swaggerUrls: prev.swaggerUrls.filter((_, i) => i !== index),
    }));
  };

  const handleSaveSetClick = async () => {
    if (!form.name.trim()) {
      setStatus({ ok: false, message: 'Enter a name for this set.' });
      return;
    }
    setIsSaving(true);
    setStatus(null);
    try {
      await saveAggregationSet(form, currentStorage(), getConnectionSettings());
      setStatus({ ok: true, message: `Saved "${form.name}".` });
      setShowForm(false);
      await refreshSets(currentStorage());
    } catch (error) {
      setStatus({ ok: false, message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirmClose = async (confirmed) => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (!confirmed || !id) {
      return;
    }
    try {
      await deleteAggregationSet(id, currentStorage(), getConnectionSettings());
      setStatus({ ok: true, message: 'Deleted.' });
      await refreshSets(currentStorage());
    } catch (error) {
      setStatus({ ok: false, message: error.message });
    }
  };

  return (
    <>
      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="Delete aggregation set"
        onClose={handleDeleteConfirmClose}
      >
        Delete this aggregation set? This removes its file from the storage branch.
      </ConfirmDialog>
      <Modal isOpen={isOpen} contentLabel="Manage Aggregation Sets">
        <ModalHeader>
          <button type="button" className="close" onClick={handleClose}>
            <span aria-hidden="true">x</span>
          </button>
          <ModalTitle>Manage Aggregation Sets</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <fieldset>
            <legend>Storage location</legend>
            <div className="input-group">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label htmlFor="input-aggregation-owner" aria-labelledby="input-aggregation-owner">
                Owner
              </label>
              <input
                id="input-aggregation-owner"
                type="text"
                className="form-control"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
            </div>
            <div className="input-group">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label htmlFor="input-aggregation-repo" aria-labelledby="input-aggregation-repo">
                Repository
              </label>
              <input
                id="input-aggregation-repo"
                type="text"
                className="form-control"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
            </div>
            <div className="input-group">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label htmlFor="input-aggregation-branch" aria-labelledby="input-aggregation-branch">
                Branch
              </label>
              <input
                id="input-aggregation-branch"
                type="text"
                className="form-control"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-secondary" onClick={handleSaveLocationClick}>
              Save Location
            </button>
          </fieldset>

          {status && <p className={status.ok ? 'text-success' : 'text-danger'}>{status.message}</p>}

          {!showForm && (
            <>
              <button type="button" className="btn btn-primary" onClick={handleNewSetClick}>
                New Set
              </button>
              {isLoadingSets && <p>Loading sets…</p>}
              {!isLoadingSets && sets.length === 0 && <p>No aggregation sets saved yet.</p>}
              <ul>
                {sets.map((set) => (
                  <li key={set.id}>
                    <strong>{set.name}</strong> ({(set.swaggerUrls || []).length} URLs)
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleEditSetClick(set)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setPendingDeleteId(set.id)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {showForm && (
            <fieldset>
              <legend>{form.id ? 'Edit set' : 'New set'}</legend>
              <div className="input-group">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label htmlFor="input-set-name" aria-labelledby="input-set-name">
                  Set name
                </label>
                <input
                  id="input-set-name"
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <ul>
                {form.swaggerUrls.map((entry, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={`${entry.url}-${index}`}>
                    {entry.name}: {entry.url}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleRemoveUrlClick(index)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <div className="input-group">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label htmlFor="input-new-url-name" aria-labelledby="input-new-url-name">
                  Service name
                </label>
                <input
                  id="input-new-url-name"
                  type="text"
                  className="form-control"
                  value={newUrlName}
                  onChange={(e) => setNewUrlName(e.target.value)}
                />
              </div>
              <div className="input-group">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label htmlFor="input-new-url-value" aria-labelledby="input-new-url-value">
                  Swagger URL
                </label>
                <input
                  id="input-new-url-value"
                  type="text"
                  className="form-control"
                  value={newUrlValue}
                  onChange={(e) => setNewUrlValue(e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-secondary" onClick={handleAddUrlClick}>
                Add URL
              </button>

              <div>
                <button type="button" className="btn btn-secondary" onClick={handleCancelFormClick}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveSetClick}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving…' : 'Save Set'}
                </button>
              </div>
            </fieldset>
          )}
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            Close
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
});

AggregateMenuHandler.displayName = 'AggregateMenuHandler';

AggregateMenuHandler.propTypes = {
  getComponent: PropTypes.func.isRequired,
};

export default AggregateMenuHandler;
