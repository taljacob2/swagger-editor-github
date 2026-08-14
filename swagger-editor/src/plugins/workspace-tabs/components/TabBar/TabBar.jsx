import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import {
  addTab,
  closeTab,
  copyTabContentToClipboard,
  duplicateTab,
  getActiveTab,
  getWorkspace,
  saveWorkspace,
  setActiveTab,
} from '../../workspace-tabs-service.js';

const COPIED_FEEDBACK_DURATION_MS = 1500;

const TabBar = ({ editorActions, EditorContentOrigin }) => {
  const [workspace, setWorkspace] = useState(() => getWorkspace());
  const [copiedTabId, setCopiedTabId] = useState(null);
  // Keyboard shortcuts are bound once on mount, so handlers read the latest
  // workspace through this ref rather than closing over stale render state.
  const workspaceRef = useRef(workspace);

  const applyWorkspace = (next, { activateContent } = {}) => {
    workspaceRef.current = next;
    saveWorkspace(next);
    setWorkspace(next);
    if (activateContent) {
      editorActions.setContent(getActiveTab(next).content, EditorContentOrigin.LocalStorage);
    }
  };

  const handleSwitch = (tabId) => {
    const { current } = workspaceRef;
    if (tabId === current.activeTabId) return;
    applyWorkspace(setActiveTab(current, tabId), { activateContent: true });
  };

  const handleAdd = () => {
    applyWorkspace(addTab(workspaceRef.current), { activateContent: true });
  };

  const handleDuplicate = (tabId) => {
    applyWorkspace(duplicateTab(workspaceRef.current, tabId), { activateContent: true });
  };

  const handleClose = (tabId) => {
    const { current } = workspaceRef;
    const wasActive = tabId === current.activeTabId;
    applyWorkspace(closeTab(current, tabId), { activateContent: wasActive });
  };

  const handleCopy = async (tab) => {
    try {
      await copyTabContentToClipboard(tab.content);
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

      const { tabs, activeTabId } = workspaceRef.current;

      if (event.key >= '1' && event.key <= '9') {
        const index = Number(event.key) - 1;
        if (index < tabs.length) {
          event.preventDefault();
          handleSwitch(tabs[index].id);
        }
        return;
      }

      if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        const delta = event.key === 'PageUp' ? -1 : 1;
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
          <button
            type="button"
            className="swagger-editor__tab-name"
            onClick={() => handleSwitch(tab.id)}
          >
            {tab.name}
          </button>
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
  }).isRequired,
  EditorContentOrigin: PropTypes.shape({
    LocalStorage: PropTypes.string.isRequired,
  }).isRequired,
};

export default TabBar;
