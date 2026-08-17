import React, { useImperativeHandle, useState, forwardRef } from 'react';
import PropTypes from 'prop-types';

import { getConnectionSettings } from '../../github-connection/github-connection-service.js';
import { aggregateSet } from '../aggregation-merge-service.js';
import {
  BRANCH_PREFIX,
  branchSuffixFromBranch,
  buildBranchName,
  canWriteToStorage,
  deleteAggregationSet,
  getRepoDefaultBranch,
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
    const [branchSuffix, setBranchSuffix] = useState('');
    const [sets, setSets] = useState([]);
    const [isLoadingSets, setIsLoadingSets] = useState(false);
    const [status, setStatus] = useState(null);
    const [showConflictDetails, setShowConflictDetails] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [newUrlName, setNewUrlName] = useState('');
    const [newUrlValue, setNewUrlValue] = useState('');
    const [isAddingUrl, setIsAddingUrl] = useState(false);
    const [editingUrlIndex, setEditingUrlIndex] = useState(null);
    const [editUrlDraft, setEditUrlDraft] = useState({ name: '', url: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [aggregatingId, setAggregatingId] = useState(null);
    const [canWrite, setCanWrite] = useState(false);
    const [repoDefaultBranch, setRepoDefaultBranch] = useState(null);

    const Modal = getComponent('Modal');
    const ModalHeader = getComponent('ModalHeader');
    const ModalTitle = getComponent('ModalTitle');
    const ModalBody = getComponent('ModalBody');
    const ModalFooter = getComponent('ModalFooter');
    const ConfirmDialog = getComponent('ConfirmDialog', true);

    // The stored branch is always the fixed prefix plus whatever the user
    // typed after it -- see aggregation-storage-service.js's BRANCH_PREFIX.
    const branch = buildBranchName(branchSuffix);

    const currentStorage = () => ({ owner, repo, branch });

    const refreshSets = async (storage) => {
      if (!storage.owner || !storage.repo) {
        setSets([]);
        setCanWrite(false);
        setRepoDefaultBranch(null);
        return;
      }
      setIsLoadingSets(true);
      const connection = await getConnectionSettings();

      // Run concurrently so a slow permission check can't delay the sets list
      // (or vice versa) — fail closed (no write controls) on any error, since
      // that's the safer default.
      const [canWriteResult, setsResult, defaultBranchResult] = await Promise.allSettled([
        canWriteToStorage(storage, connection),
        listAggregationSets(storage, connection),
        getRepoDefaultBranch(storage, connection),
      ]);

      setCanWrite(canWriteResult.status === 'fulfilled' ? canWriteResult.value : false);
      setRepoDefaultBranch(
        defaultBranchResult.status === 'fulfilled' ? defaultBranchResult.value : null
      );
      if (setsResult.status === 'fulfilled') {
        setSets(setsResult.value);
      } else {
        setStatus({ ok: false, message: setsResult.reason.message });
      }
      setIsLoadingSets(false);
    };

    useImperativeHandle(ref, () => ({
      openModal() {
        const settings = getStorageSettings();
        setOwner(settings.owner);
        setRepo(settings.repo);
        setBranchSuffix(branchSuffixFromBranch(settings.branch));
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
      setBranchSuffix(branchSuffixFromBranch(settings.branch));
      setStatus({ ok: true, message: 'Storage location saved.' });
      refreshSets(settings);
    };

    const handleNewSetClick = () => {
      setForm(emptyForm);
      setNewUrlName('');
      setNewUrlValue('');
      // A brand-new set is always empty, so "add a service" is virtually
      // certain to be the very next thing the user does -- start expanded.
      setIsAddingUrl(true);
      setEditingUrlIndex(null);
      setShowForm(true);
    };

    const handleEditSetClick = (set) => {
      const swaggerUrls = set.swaggerUrls || [];
      setForm({ id: set.id, name: set.name, swaggerUrls });
      setNewUrlName('');
      setNewUrlValue('');
      // Someone opening Edit on a set that already has services is usually
      // here to tweak one, not add another -- keep the add-service fields
      // collapsed by default so they aren't staring at empty inputs they
      // didn't ask for. A set with no services yet has nothing else to do,
      // so it still starts expanded.
      setIsAddingUrl(swaggerUrls.length === 0);
      setEditingUrlIndex(null);
      setShowForm(true);
    };

    const handleCancelFormClick = () => {
      setEditingUrlIndex(null);
      setShowForm(false);
    };

    const handleStartAddUrlClick = () => setIsAddingUrl(true);

    const handleDoneAddingUrlClick = () => {
      setIsAddingUrl(false);
      setNewUrlName('');
      setNewUrlValue('');
    };

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

    const handleStartEditUrlClick = (index, entry) => {
      setEditUrlDraft({ name: entry.name, url: entry.url });
      setEditingUrlIndex(index);
    };

    const handleCancelEditUrlClick = () => setEditingUrlIndex(null);

    const handleSaveEditUrlClick = () => {
      if (!editUrlDraft.url.trim()) {
        return;
      }
      const index = editingUrlIndex;
      const entry = {
        name: editUrlDraft.name.trim() || `Service ${index + 1}`,
        url: editUrlDraft.url.trim(),
      };
      setForm((prev) => ({
        ...prev,
        swaggerUrls: prev.swaggerUrls.map((existing, i) => (i === index ? entry : existing)),
      }));
      setEditingUrlIndex(null);
    };

    const handleEditUrlKeyDown = (event) => {
      if (event.key === 'Enter') {
        handleSaveEditUrlClick();
      } else if (event.key === 'Escape') {
        handleCancelEditUrlClick();
      }
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
      setShowConflictDetails(false);
      try {
        const result = await aggregateSet(set, await getConnectionSettings());
        editorActions.setContent(result.yaml, EditorContentOrigin.Aggregation);

        const conflictCount =
          result.conflicts.paths.length +
          result.conflicts.tags.length +
          result.conflicts.components.length;
        const errorNote = result.errors.length
          ? ` (${result.errors.length} URL${result.errors.length === 1 ? '' : 's'} failed: ${result.errors
              .map((e) => e.name)
              .join(', ')})`
          : '';
        setStatus({
          ok: true,
          message: `Loaded "${set.name}" into the editor: ${result.specCount} spec(s) merged`,
          conflictLabel: conflictCount
            ? `resolved ${conflictCount} naming conflict${conflictCount === 1 ? '' : 's'}`
            : null,
          conflicts: conflictCount ? result.conflicts : null,
          suffix: `.${errorNote}`,
        });
      } catch (error) {
        setStatus({ ok: false, message: error.message });
      } finally {
        setAggregatingId(null);
      }
    };

    const handleToggleConflictDetailsClick = () => {
      setShowConflictDetails((isOpenAlready) => !isOpenAlready);
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

    const isBranchDefaultBranch = Boolean(repoDefaultBranch) && branch.trim() === repoDefaultBranch;
    const canEditSets = canWrite && !isBranchDefaultBranch;

    const conflictGroups = status?.conflicts
      ? [
          {
            key: 'paths',
            title: 'Paths',
            items: status.conflicts.paths.map((c) => ({
              key: c.path,
              label: c.path,
              renamed: c.renamed,
            })),
          },
          {
            key: 'tags',
            title: 'Tags',
            items: status.conflicts.tags.map((c) => ({
              key: c.tagName,
              label: c.tagName,
              renamed: c.renamed,
            })),
          },
          {
            key: 'components',
            title: 'Components',
            items: status.conflicts.components.map((c) => ({
              key: `${c.type}:${c.name}`,
              label: `${c.name} (${c.type})`,
              renamed: c.renamed,
            })),
          },
        ].filter((group) => group.items.length > 0)
      : [];

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
                  <div className="swagger-editor__aggregate-branch-field">
                    <span className="swagger-editor__aggregate-branch-prefix">{BRANCH_PREFIX}</span>
                    <input
                      id="input-aggregation-branch"
                      type="text"
                      className="form-control swagger-editor__aggregate-branch-suffix-input"
                      value={branchSuffix}
                      aria-invalid={isBranchDefaultBranch}
                      onChange={(e) => setBranchSuffix(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              {isBranchDefaultBranch && (
                <p className="swagger-editor__aggregate-alert swagger-editor__aggregate-alert--error">
                  &quot;{branch.trim()}&quot; is <code>{`${owner}/${repo}`}</code>&apos;s default
                  branch — choose a different branch so aggregation sets aren&apos;t committed on
                  top of it.
                </p>
              )}
              <button
                type="button"
                className="btn btn-secondary swagger-editor__aggregate-save-location"
                onClick={handleSaveLocationClick}
                disabled={isBranchDefaultBranch}
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
                {status.conflictLabel && (
                  <>
                    {', '}
                    <button
                      type="button"
                      className="swagger-editor__aggregate-inline-link"
                      onClick={handleToggleConflictDetailsClick}
                      aria-expanded={showConflictDetails}
                    >
                      {status.conflictLabel}
                    </button>
                  </>
                )}
                {status.suffix}
              </p>
            )}

            {conflictGroups.length > 0 && showConflictDetails && (
              <div className="swagger-editor__aggregate-conflict-details">
                {conflictGroups.map((group) => (
                  <div key={group.key} className="swagger-editor__aggregate-conflict-group">
                    <div className="swagger-editor__aggregate-conflict-group-title">
                      {group.title}
                    </div>
                    <ul className="swagger-editor__aggregate-conflict-list">
                      {group.items.map((item) => (
                        <li key={item.key} className="swagger-editor__aggregate-conflict-item">
                          <code>{item.label}</code>
                          <ul className="swagger-editor__aggregate-conflict-renamed-list">
                            {item.renamed.map((r) => (
                              <li key={r.service}>
                                {r.service} &rarr; <code>{r.to}</code>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {!showForm && isLoadingSets && (
              <p className="swagger-editor__aggregate-note">Loading sets…</p>
            )}

            {/* Held back until loading resolves -- otherwise canWrite's stale/default value
                paints a wrong permission note that then flips once the real check lands. */}
            {!showForm && !isLoadingSets && (
              <>
                {canEditSets && (
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
                {sets.length === 0 && (
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
                          {canEditSets && (
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
                    {form.swaggerUrls.map((entry, index) => {
                      const isEditingThis = editingUrlIndex === index;
                      const isEditingOther =
                        (editingUrlIndex !== null && !isEditingThis) || isAddingUrl;
                      return (
                        <li
                          // eslint-disable-next-line react/no-array-index-key
                          key={`${entry.url}-${index}`}
                          className="swagger-editor__aggregate-url-row"
                        >
                          {isEditingThis ? (
                            <>
                              <div className="swagger-editor__aggregate-url-edit-fields">
                                <input
                                  type="text"
                                  aria-label="Edit service name"
                                  value={editUrlDraft.name}
                                  onChange={(e) =>
                                    setEditUrlDraft((prev) => ({ ...prev, name: e.target.value }))
                                  }
                                  onKeyDown={handleEditUrlKeyDown}
                                  // eslint-disable-next-line jsx-a11y/no-autofocus
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  aria-label="Edit Swagger URL"
                                  value={editUrlDraft.url}
                                  onChange={(e) =>
                                    setEditUrlDraft((prev) => ({ ...prev, url: e.target.value }))
                                  }
                                  onKeyDown={handleEditUrlKeyDown}
                                />
                              </div>
                              <div className="swagger-editor__aggregate-url-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={handleCancelEditUrlClick}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={!editUrlDraft.url.trim()}
                                  onClick={handleSaveEditUrlClick}
                                >
                                  Save
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="swagger-editor__aggregate-url-info">
                                <div className="swagger-editor__aggregate-url-name">
                                  {entry.name}
                                </div>
                                <div className="swagger-editor__aggregate-url-value">
                                  {entry.url}
                                </div>
                              </div>
                              <div className="swagger-editor__aggregate-url-actions">
                                <button
                                  type="button"
                                  className="swagger-editor__aggregate-icon-button"
                                  aria-label="Move up"
                                  title="Move up"
                                  disabled={index === 0 || isEditingOther}
                                  onClick={() => handleMoveUrlClick(index, 'up')}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="swagger-editor__aggregate-icon-button"
                                  aria-label="Move down"
                                  title="Move down"
                                  disabled={index === form.swaggerUrls.length - 1 || isEditingOther}
                                  onClick={() => handleMoveUrlClick(index, 'down')}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  className="swagger-editor__aggregate-icon-button"
                                  aria-label="Edit"
                                  title="Edit"
                                  disabled={isEditingOther}
                                  onClick={() => handleStartEditUrlClick(index, entry)}
                                >
                                  ✎
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={isEditingOther}
                                  onClick={() => handleRemoveUrlClick(index)}
                                >
                                  Remove
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {isAddingUrl ? (
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
                        disabled={editingUrlIndex !== null}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
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
                        disabled={editingUrlIndex !== null}
                        onChange={(e) => setNewUrlValue(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary swagger-editor__aggregate-add-url-button"
                      disabled={editingUrlIndex !== null}
                      onClick={handleAddUrlClick}
                    >
                      Add URL
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label="Hide add-service fields"
                      title="Hide add-service fields"
                      disabled={editingUrlIndex !== null}
                      onClick={handleDoneAddingUrlClick}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary swagger-editor__aggregate-add-service-toggle"
                    disabled={editingUrlIndex !== null}
                    onClick={handleStartAddUrlClick}
                  >
                    + Add Service
                  </button>
                )}

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
                    disabled={isSaving || isBranchDefaultBranch}
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
