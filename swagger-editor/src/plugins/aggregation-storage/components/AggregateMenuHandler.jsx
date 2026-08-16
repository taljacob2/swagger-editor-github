import React, { useImperativeHandle, useState, forwardRef } from 'react';
import PropTypes from 'prop-types';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import { aggregateSet } from '../aggregation-merge-service.js';
import {
  canWriteToStorage,
  deleteAggregationSet,
  getStorageSettings,
  listAggregationSets,
  moveSwaggerUrl,
  saveAggregationSet,
  saveStorageSettings,
} from '../aggregation-storage-service.js';

const emptyForm = { id: null, name: '', swaggerUrls: [] };

const PERMISSION_DENIED_MESSAGE =
  "You don't have write access to this repo — see docs/Permissions.md for how to get a token that can save sets.";

const AggregateMenuHandler = forwardRef(
  ({ getComponent, editorActions, EditorContentOrigin }, ref) => {
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
    const [aggregatingId, setAggregatingId] = useState(null);
    const [canWrite, setCanWrite] = useState(false);

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
        setCanWrite(false);
        return;
      }
      setIsLoadingSets(true);
      const connection = await getConnectionSettings();

      // Resolved independently so a permission-check hiccup never blocks the
      // sets list itself from loading — fail closed (no write controls) on
      // any error, since that's the safer default.
      try {
        setCanWrite(await canWriteToStorage(storage, connection));
      } catch {
        setCanWrite(false);
      }

      try {
        const result = await listAggregationSets(storage, connection);
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

    const handleMoveUrlClick = (index, direction) => {
      setForm((prev) => ({
        ...prev,
        swaggerUrls: moveSwaggerUrl(prev.swaggerUrls, index, direction),
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
        await saveAggregationSet(form, currentStorage(), await getConnectionSettings());
        setStatus({ ok: true, message: `Saved "${form.name}".` });
        setShowForm(false);
        await refreshSets(currentStorage());
      } catch (error) {
        const message =
          error.status === 403 || error.status === 401 ? PERMISSION_DENIED_MESSAGE : error.message;
        setStatus({ ok: false, message });
      } finally {
        setIsSaving(false);
      }
    };

    const handleAggregateClick = async (set) => {
      setAggregatingId(set.id);
      setStatus(null);
      try {
        const result = await aggregateSet(set, await getConnectionSettings());
        editorActions.setContent(result.yaml, EditorContentOrigin.Aggregation);

        const conflictCount =
          result.conflicts.paths.length +
          result.conflicts.tags.length +
          result.conflicts.components.length;
        const conflictNote = conflictCount
          ? `, resolved ${conflictCount} naming conflict${conflictCount === 1 ? '' : 's'}`
          : '';
        const errorNote = result.errors.length
          ? ` (${result.errors.length} URL${result.errors.length === 1 ? '' : 's'} failed: ${result.errors
              .map((e) => e.name)
              .join(', ')})`
          : '';
        setStatus({
          ok: true,
          message: `Loaded "${set.name}" into the editor: ${result.specCount} spec(s) merged${conflictNote}.${errorNote}`,
        });
      } catch (error) {
        setStatus({ ok: false, message: error.message });
      } finally {
        setAggregatingId(null);
      }
    };

    const handleDeleteConfirmClose = async (confirmed) => {
      const id = pendingDeleteId;
      setPendingDeleteId(null);
      if (!confirmed || !id) {
        return;
      }
      try {
        await deleteAggregationSet(id, currentStorage(), await getConnectionSettings());
        setStatus({ ok: true, message: 'Deleted.' });
        await refreshSets(currentStorage());
      } catch (error) {
        const message =
          error.status === 403 || error.status === 401 ? PERMISSION_DENIED_MESSAGE : error.message;
        setStatus({ ok: false, message });
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
            <fieldset className="swagger-editor__aggregate-section">
              <legend className="swagger-editor__aggregate-section-title">Storage location</legend>
              <div className="swagger-editor__aggregate-storage-grid">
                <div className="input-group">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label
                    htmlFor="input-aggregation-owner"
                    aria-labelledby="input-aggregation-owner"
                  >
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
                  <label
                    htmlFor="input-aggregation-branch"
                    aria-labelledby="input-aggregation-branch"
                  >
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
              </div>
              <button
                type="button"
                className="btn btn-secondary swagger-editor__aggregate-save-location"
                onClick={handleSaveLocationClick}
              >
                Save Location
              </button>
            </fieldset>

            {status && (
              <p
                className={
                  status.ok
                    ? 'swagger-editor__aggregate-alert swagger-editor__aggregate-alert--success'
                    : 'swagger-editor__aggregate-alert swagger-editor__aggregate-alert--error'
                }
              >
                {status.message}
              </p>
            )}

            {!showForm && (
              <>
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn-primary swagger-editor__aggregate-new-set-button"
                    onClick={handleNewSetClick}
                  >
                    New Set
                  </button>
                )}
                {!canWrite && owner && repo && (
                  <p className="swagger-editor__aggregate-note">
                    Read-only — you don&apos;t have write access to{' '}
                    <code>{`${owner}/${repo}`}</code>. See docs/Permissions.md to get a token that
                    can save sets.
                  </p>
                )}
                {isLoadingSets && <p className="swagger-editor__aggregate-note">Loading sets…</p>}
                {!isLoadingSets && sets.length === 0 && (
                  <p className="swagger-editor__aggregate-note">No aggregation sets saved yet.</p>
                )}
                <ul className="swagger-editor__aggregate-set-list">
                  {sets.map((set) => {
                    const urls = set.swaggerUrls || [];
                    return (
                      <li key={set.id} className="swagger-editor__aggregate-set-card">
                        <div className="swagger-editor__aggregate-set-info">
                          <div className="swagger-editor__aggregate-set-name">{set.name}</div>
                          <div className="swagger-editor__aggregate-set-meta">
                            {urls.length} service{urls.length === 1 ? '' : 's'}
                          </div>
                          {urls.length > 0 && (
                            <ul className="swagger-editor__aggregate-set-chips">
                              {urls.map((entry, index) => (
                                <li
                                  // eslint-disable-next-line react/no-array-index-key
                                  key={`${entry.url}-${index}`}
                                  className="swagger-editor__aggregate-chip"
                                >
                                  {entry.name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="swagger-editor__aggregate-set-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleAggregateClick(set)}
                            disabled={aggregatingId === set.id}
                          >
                            {aggregatingId === set.id ? 'Aggregating…' : 'Aggregate'}
                          </button>
                          {canWrite && (
                            <>
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
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {showForm && (
              <fieldset className="swagger-editor__aggregate-section">
                <legend className="swagger-editor__aggregate-section-title">
                  {form.id ? 'Edit set' : 'New set'}
                </legend>
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

                {form.swaggerUrls.length > 0 && (
                  <ul className="swagger-editor__aggregate-url-list">
                    {form.swaggerUrls.map((entry, index) => (
                      <li
                        // eslint-disable-next-line react/no-array-index-key
                        key={`${entry.url}-${index}`}
                        className="swagger-editor__aggregate-url-row"
                      >
                        <div className="swagger-editor__aggregate-url-info">
                          <div className="swagger-editor__aggregate-url-name">{entry.name}</div>
                          <div className="swagger-editor__aggregate-url-value">{entry.url}</div>
                        </div>
                        <div className="swagger-editor__aggregate-url-actions">
                          <button
                            type="button"
                            className="swagger-editor__aggregate-icon-button"
                            aria-label="Move up"
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => handleMoveUrlClick(index, 'up')}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="swagger-editor__aggregate-icon-button"
                            aria-label="Move down"
                            title="Move down"
                            disabled={index === form.swaggerUrls.length - 1}
                            onClick={() => handleMoveUrlClick(index, 'down')}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleRemoveUrlClick(index)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="swagger-editor__aggregate-add-url-row">
                  <div className="input-group swagger-editor__aggregate-add-url-name">
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
                  <div className="input-group swagger-editor__aggregate-add-url-value">
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
                  <button
                    type="button"
                    className="btn btn-secondary swagger-editor__aggregate-add-url-button"
                    onClick={handleAddUrlClick}
                  >
                    Add URL
                  </button>
                </div>

                <div className="swagger-editor__aggregate-form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCancelFormClick}
                  >
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
  }
);

AggregateMenuHandler.displayName = 'AggregateMenuHandler';

AggregateMenuHandler.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorActions: PropTypes.shape({
    setContent: PropTypes.func.isRequired,
  }).isRequired,
  EditorContentOrigin: PropTypes.shape({
    Aggregation: PropTypes.string.isRequired,
  }).isRequired,
};

export default AggregateMenuHandler;
