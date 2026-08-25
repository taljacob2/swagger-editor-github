import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import {
  addTab,
  closeTab,
  duplicateTab,
  getTabContent,
  getWorkspaceMeta,
  removeTabContent,
  renameTab,
  reorderTab,
  saveWorkspaceMeta,
  setActiveTab,
  setTabContent,
} from '../../workspace-tabs-service.js';

const TabBar = ({ editorActions, EditorContentOrigin }) => {
  const [workspace, setWorkspace] = useState(() => getWorkspaceMeta());
  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggedTabId, setDraggedTabId] = useState(null);
  // Which tab is currently being dragged over, and which side of it (the
  // reorder target/position pair `reorderTab` expects) -- drives both the
  // drop-indicator styling and the actual reorder on drop.
  const [dropIndicator, setDropIndicator] = useState(null);
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

  const dropPositionFor = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left > rect.width / 2 ? 'after' : 'before';
  };

  const handleDragStart = (event, tabId) => {
    setDraggedTabId(tabId);
    const { dataTransfer } = event;
    dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag at all unless data is actually set.
    dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOver = (event, tabId) => {
    if (!draggedTabId || draggedTabId === tabId) return;
    event.preventDefault();
    const { dataTransfer } = event;
    dataTransfer.dropEffect = 'move';
    const position = dropPositionFor(event);
    setDropIndicator((current) =>
      current && current.tabId === tabId && current.position === position
        ? current
        : { tabId, position }
    );
  };

  const handleDragLeave = (event, tabId) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropIndicator((current) => (current && current.tabId === tabId ? null : current));
  };

  const handleDrop = (event, tabId) => {
    event.preventDefault();
    const sourceTabId = draggedTabId;
    setDraggedTabId(null);
    setDropIndicator(null);
    if (!sourceTabId || sourceTabId === tabId) return;
    applyWorkspace(reorderTab(getWorkspaceMeta(), sourceTabId, tabId, dropPositionFor(event)));
  };

  const handleDragEnd = () => {
    setDraggedTabId(null);
    setDropIndicator(null);
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
        return;
      }

      const key = event.key.toLowerCase();
      const activeTab = tabs.find((tab) => tab.id === activeTabId);

      if (key === 't') {
        event.preventDefault();
        handleAdd();
      } else if (key === 'q') {
        event.preventDefault();
        if (activeTab) handleClose(activeTab.id);
      } else if (key === 's') {
        event.preventDefault();
        if (activeTab) handleDuplicate(activeTab.id);
      } else if (key === 'x') {
        event.preventDefault();
        if (activeTab) handleStartRename(activeTab);
      }
    };

    // Capture phase: Monaco's own keybinding service can claim an Alt+<letter>
    // combo (e.g. Alt+R) and stop it from ever bubbling up to a window-level
    // bubble-phase listener while the editor has focus. Running ahead of that,
    // during capture, guarantees these shortcuts fire regardless of focus.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="swagger-editor__tab-bar">
      {workspace.tabs.map((tab) => (
        <div
          key={tab.id}
          draggable={renamingTabId !== tab.id}
          onDragStart={(event) => handleDragStart(event, tab.id)}
          onDragOver={(event) => handleDragOver(event, tab.id)}
          onDragLeave={(event) => handleDragLeave(event, tab.id)}
          onDrop={(event) => handleDrop(event, tab.id)}
          onDragEnd={handleDragEnd}
          className={[
            'swagger-editor__tab',
            tab.id === workspace.activeTabId && 'swagger-editor__tab--active',
            draggedTabId === tab.id && 'swagger-editor__tab--dragging',
            dropIndicator?.tabId === tab.id &&
              `swagger-editor__tab--drag-over-${dropIndicator.position}`,
          ]
            .filter(Boolean)
            .join(' ')}
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
