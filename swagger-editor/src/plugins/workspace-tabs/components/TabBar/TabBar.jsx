import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { CopyIcon, GitPullRequestIcon, XIcon } from '@primer/octicons-react';

import {
  addTab,
  closeTab,
  duplicateTab,
  getTabContent,
  getWorkspaceMeta,
  onWorkspaceChanged,
  removeTabContent,
  renameTab,
  reorderTab,
  saveWorkspaceMeta,
  setActiveTab,
  setTabContent,
} from '../../workspace-tabs-service.js';
import { getLinkedTarget, removeLinkedTarget } from '../../linked-target-service.js';
import SuggestPrModal from '../SuggestPrModal.jsx';

const TabBar = ({
  getComponent,
  editorActions,
  EditorContentOrigin,
  flushPendingEditorContent,
}) => {
  const [workspace, setWorkspace] = useState(() => getWorkspaceMeta());
  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  // Linking has no modal of its own -- SuggestPrModal handles it as a phase
  // of its own state machine (entering it automatically when the tab isn't
  // linked yet), so this is the only piece of state this bar needs for the
  // whole feature.
  const [suggestingTabId, setSuggestingTabId] = useState(null);
  const [draggedTabId, setDraggedTabId] = useState(null);
  // Which tab is currently being dragged over, and which side of it (the
  // reorder target/position pair `reorderTab` expects) -- drives both the
  // drop-indicator styling and the actual reorder on drop.
  const [dropIndicator, setDropIndicator] = useState(null);
  // Escape blurs the rename input (to unify save/cancel into one onBlur path),
  // so this flag tells that handler to discard instead of commit.
  const cancelRenameRef = useRef(false);
  const renameInputRef = useRef(null);

  // Drives the left/right edge fade overlays (see _tab-bar.scss) that hint
  // there are more tabs off-screen -- only shown on the side(s) that
  // actually have more to scroll to, not unconditionally.
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });
  // Keyed by tab id (not index/ref array) so a mid-list close/reorder can't
  // leave a stale ref pointing at the wrong tab.
  const tabRefs = useRef({});

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollState({
      canScrollLeft: el.scrollLeft > 0,
      // -1px epsilon: some browsers report a fractional scrollWidth that's
      // a hair short of scrollLeft + clientWidth even when fully scrolled.
      canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    // Catches width changes scrolling alone wouldn't fire for -- a tab
    // added/closed/renamed, or the bar itself resizing with the window.
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A tab created/linked by something outside this component (e.g. the repo
  // browser, wired in from FileMenu) writes straight to localStorage and
  // then calls notifyWorkspaceChanged() -- re-read so the new tab shows up
  // here without this component having caused the change itself.
  useEffect(() => onWorkspaceChanged(() => setWorkspace(getWorkspaceMeta())), []);

  useEffect(() => {
    tabRefs.current[workspace.activeTabId]?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [workspace.activeTabId]);

  // Every keystroke in the active tab is persisted independently by the
  // wrap-actions.js setContent wrapper, straight to localStorage -- it does
  // NOT flow through this component's state. So every mutation here must
  // start from a fresh getWorkspaceMeta() read, not the last-rendered
  // `workspace`, or it would save a stale snapshot over that content the
  // moment a tab is added/closed/switched/renamed.
  const applyWorkspace = (next, { activateContentFor } = {}) => {
    // Flush (not cancel) any keystroke from the *currently* active tab that's
    // still sitting in the shared setContentDebounced timer -- it's keyed
    // globally, not per tab, so left pending it would otherwise land after
    // this switch and overwrite whichever tab becomes active next with this
    // tab's stale content (see flushPendingSetContent's own comment). Doing
    // this before saveWorkspaceMeta below is what makes the flush apply to
    // the outgoing tab rather than the incoming one.
    flushPendingEditorContent?.();
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
      removeLinkedTarget(tabId);
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
      {/* Wraps just the scrollable region (not the ever-visible + button
          below) so the fade overlays can be positioned relative to its
          edges alone. */}
      <div className="swagger-editor__tab-bar-scroll-wrapper">
        <div className="swagger-editor__tab-bar-scroll" ref={scrollRef}>
          {workspace.tabs.map((tab) => (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current[tab.id] = el;
                else delete tabRefs.current[tab.id];
              }}
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
                title={
                  getLinkedTarget(tab.id)
                    ? `Suggest pull request to ${getLinkedTarget(tab.id).owner}/${
                        getLinkedTarget(tab.id).repo
                      }`
                    : 'Link to a repository file & suggest a pull request'
                }
                onClick={() => setSuggestingTabId(tab.id)}
              >
                <GitPullRequestIcon size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="swagger-editor__tab-action"
                title="Duplicate tab"
                onClick={() => handleDuplicate(tab.id)}
              >
                <CopyIcon size={14} aria-hidden="true" />
              </button>
              {workspace.tabs.length > 1 && (
                <button
                  type="button"
                  className="swagger-editor__tab-action"
                  title="Close tab"
                  onClick={() => handleClose(tab.id)}
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        <span
          className="swagger-editor__tab-bar-fade swagger-editor__tab-bar-fade--left"
          aria-hidden="true"
          style={{ opacity: scrollState.canScrollLeft ? 1 : 0 }}
        />
        <span
          className="swagger-editor__tab-bar-fade swagger-editor__tab-bar-fade--right"
          aria-hidden="true"
          style={{ opacity: scrollState.canScrollRight ? 1 : 0 }}
        />
      </div>
      <button type="button" className="swagger-editor__tab-add" title="New tab" onClick={handleAdd}>
        +
      </button>
      <SuggestPrModal
        getComponent={getComponent}
        isOpen={suggestingTabId !== null}
        tabId={suggestingTabId}
        editorActions={editorActions}
        onClose={() => setSuggestingTabId(null)}
      />
    </div>
  );
};

TabBar.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorActions: PropTypes.shape({
    setContent: PropTypes.func.isRequired,
    setActiveDocument: PropTypes.func,
    disposeDocument: PropTypes.func,
  }).isRequired,
  EditorContentOrigin: PropTypes.shape({
    LocalStorage: PropTypes.string.isRequired,
  }).isRequired,
  flushPendingEditorContent: PropTypes.func,
};

export default TabBar;
