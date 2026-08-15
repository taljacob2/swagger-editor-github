import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import {
  addTab,
  closeTab,
  copyTabContentToClipboard,
  duplicateTab,
  getTabContent,
  getWorkspaceMeta,
  removeTabContent,
  renameTab,
  saveWorkspaceMeta,
  setActiveTab,
  setTabContent,
} from '../../workspace-tabs-service.js';

const COPIED_FEEDBACK_DURATION_MS = 1500;

const TabBar = ({ editorActions, EditorContentOrigin }) => {
  const [workspace, setWorkspace] = useState(() => getWorkspaceMeta());
  const [copiedTabId, setCopiedTabId] = useState(null);
  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  // Escape blurs the rename input (to unify save/cancel into one onBlur path),
  // so this flag tells that handler to discard instead of commit.
  const cancelRenameRef = useRef(false);
  const renameInputRef = useRef(null);

  // Every keystroke in the active tab is persisted independently by the
  // wrap-actions.js setContent wrapper, straight to localStorage -- it does
  // NOT flow through this component's state. So every mutation here must
  // start from a fresh getWorkspaceMeta() read, not the last-rendered
  // `workspace`, or it would save a stale snapshot over that content the
  // moment a tab is added/closed/switched/renamed.
  const applyWorkspace = (next, { activateContentFor } = {}) => {
    saveWorkspaceMeta(next);
    setWorkspace(next);
    if (activateContentFor) {
      // setActiveDocument is optional-chained: it's only defined when
      // editor-monaco's per-document model support is loaded (the textarea
      // preset doesn't have it), and workspace-tabs is used by both presets.
      editorActions.setActiveDocument?.(activateContentFor);
      editorActions.setContent(getTabContent(activateContentFor), EditorContentOrigin.LocalStorage);
    }
  };

  const handleSwitch = (tabId) => {
    const current = getWorkspaceMeta();
    if (tabId === current.activeTabId) return;
    applyWorkspace(setActiveTab(current, tabId), { activateContentFor: tabId });
  };

  const handleAdd = () => {
    const next = addTab(getWorkspaceMeta());
    applyWorkspace(next, { activateContentFor: next.activeTabId });
  };

  const handleDuplicate = (tabId) => {
    const current = getWorkspaceMeta();
    const sourceContent = getTabContent(tabId);
    const next = duplicateTab(current, tabId);
    if (next !== current) {
      setTabContent(next.activeTabId, sourceContent);
    }
    applyWorkspace(next, { activateContentFor: next.activeTabId });
  };

  const handleClose = (tabId) => {
    const current = getWorkspaceMeta();
    const wasActive = tabId === current.activeTabId;
    const next = closeTab(current, tabId);
    if (next !== current) {
      removeTabContent(tabId);
      editorActions.disposeDocument?.(tabId);
    }
    applyWorkspace(next, wasActive ? { activateContentFor: next.activeTabId } : {});
  };

  const handleStartRename = (tab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.name);
  };

  const handleRenameBlur = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
    } else {
      applyWorkspace(renameTab(getWorkspaceMeta(), renamingTabId, renameValue));
    }
    setRenamingTabId(null);
  };

  const handleRenameKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelRenameRef.current = true;
      event.currentTarget.blur();
    }
  };

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  const handleCopy = async (tab) => {
    try {
      await copyTabContentToClipboard(getTabContent(tab.id));
      setCopiedTabId(tab.id);
      setTimeout(() => {
        setCopiedTabId((current) => (current === tab.id ? null : current));
      }, COPIED_FEEDBACK_DURATION_MS);
    } catch (error) {
      console.error('Failed to copy tab content to clipboard:', error); // eslint-disable-line no-console
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.altKey) return;

      const { tabs, activeTabId } = getWorkspaceMeta();

      if (event.key >= '1' && event.key <= '9') {
        const index = Number(event.key) - 1;
        if (index < tabs.length) {
          event.preventDefault();
          handleSwitch(tabs[index].id);
        }
        return;
      }

      if (event.key === '`' || event.key === '~') {
        event.preventDefault();
        const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        const delta = event.key === '~' ? -1 : 1;
        const nextIndex = (activeIndex + delta + tabs.length) % tabs.length;
        handleSwitch(tabs[nextIndex].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="swagger-editor__tab-bar">
      {workspace.tabs.map((tab) => (
        <div
          key={tab.id}
          className={
            tab.id === workspace.activeTabId
              ? 'swagger-editor__tab swagger-editor__tab--active'
              : 'swagger-editor__tab'
          }
        >
          {renamingTabId === tab.id ? (
            <input
              ref={renameInputRef}
              type="text"
              className="swagger-editor__tab-name-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={handleRenameBlur}
              onKeyDown={handleRenameKeyDown}
            />
          ) : (
            <button
              type="button"
              className="swagger-editor__tab-name"
              onClick={() => handleSwitch(tab.id)}
              onDoubleClick={() => handleStartRename(tab)}
              title="Double-click to rename"
            >
              {tab.name}
            </button>
          )}
          <button
            type="button"
            className="swagger-editor__tab-action"
            title="Duplicate tab"
            onClick={() => handleDuplicate(tab.id)}
          >
            ⧉
          </button>
          <button
            type="button"
            className="swagger-editor__tab-action"
            title="Copy tab content to clipboard"
            onClick={() => handleCopy(tab)}
          >
            {copiedTabId === tab.id ? '✓' : '⎘'}
          </button>
          {workspace.tabs.length > 1 && (
            <button
              type="button"
              className="swagger-editor__tab-action"
              title="Close tab"
              onClick={() => handleClose(tab.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" className="swagger-editor__tab-add" title="New tab" onClick={handleAdd}>
        +
      </button>
    </div>
  );
};

TabBar.propTypes = {
  editorActions: PropTypes.shape({
    setContent: PropTypes.func.isRequired,
    setActiveDocument: PropTypes.func,
    disposeDocument: PropTypes.func,
  }).isRequired,
  EditorContentOrigin: PropTypes.shape({
    LocalStorage: PropTypes.string.isRequired,
  }).isRequired,
};

export default TabBar;
