import React, { useState, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';

import RepoBrowserModal from '../../../../github-repo-browser/components/RepoBrowserModal.jsx';
import {
  addTab,
  getWorkspaceMeta,
  notifyWorkspaceChanged,
  saveWorkspaceMeta,
  setTabContent,
} from '../../../../workspace-tabs/workspace-tabs-service.js';
import { setLinkedTarget } from '../../../../workspace-tabs/linked-target-service.js';

const BrowseRepoMenuItemHandler = forwardRef(
  ({ getComponent, editorActions, EditorContentOrigin }, ref) => {
    const [isOpen, setIsOpen] = useState(false);

    useImperativeHandle(ref, () => ({
      openModal() {
        setIsOpen(true);
      },
    }));

    const handleClose = () => setIsOpen(false);

    // Mirrors importUrlSuccess's own setContent call, but into a brand-new
    // tab rather than the currently active one -- a browsed file is a
    // distinct spec the user is bringing in, not a replacement for whatever
    // they were already editing.
    const handleFileSelected = ({ owner, repo, path, ref: fileRef, apiBaseUrl, content }) => {
      const current = getWorkspaceMeta();
      const next = addTab(current);
      saveWorkspaceMeta(next);
      setTabContent(next.activeTabId, content);
      setLinkedTarget(next.activeTabId, {
        apiBaseUrl,
        owner,
        repo,
        path,
        ref: fileRef,
        baselineContent: content,
        baselineFetchedAt: new Date().toISOString(),
      });
      notifyWorkspaceChanged();
      editorActions.setActiveDocument?.(next.activeTabId);
      editorActions.setContent(content, EditorContentOrigin.ImportUrl);
    };

    return (
      <RepoBrowserModal
        getComponent={getComponent}
        isOpen={isOpen}
        onClose={handleClose}
        onFileSelected={handleFileSelected}
      />
    );
  }
);

BrowseRepoMenuItemHandler.displayName = 'BrowseRepoMenuItemHandler';

BrowseRepoMenuItemHandler.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorActions: PropTypes.shape({
    setContent: PropTypes.func.isRequired,
    setActiveDocument: PropTypes.func,
  }).isRequired,
  EditorContentOrigin: PropTypes.shape({
    ImportUrl: PropTypes.string.isRequired,
  }).isRequired,
};

export default BrowseRepoMenuItemHandler;
