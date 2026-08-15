import { getActiveTab, getTabContent, getWorkspaceMeta } from './workspace-tabs-service.js';

const afterLoad = (system) => {
  const { editorActions, editorSelectors, EditorContentOrigin } = system;

  const activeTab = getActiveTab(getWorkspaceMeta());
  const content = getTabContent(activeTab.id);

  // Tag the initial document before the editor ever mounts, so the very
  // first Monaco model it creates is already keyed to the real active tab
  // (see editor-monaco's per-document model support in MonacoEditor.jsx).
  editorActions.setActiveDocument?.(activeTab.id);

  if (editorSelectors.selectContent() === content) return; // content already loaded

  editorActions.setContent(content, EditorContentOrigin.LocalStorage);
};

export default afterLoad;
