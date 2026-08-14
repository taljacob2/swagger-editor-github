import { getActiveTab, getWorkspace } from './workspace-tabs-service.js';

const afterLoad = (system) => {
  const { editorActions, editorSelectors, EditorContentOrigin } = system;

  const activeTab = getActiveTab(getWorkspace());

  if (editorSelectors.selectContent() === activeTab.content) return; // content already loaded

  editorActions.setContent(activeTab.content, EditorContentOrigin.LocalStorage);
};

export default afterLoad;
