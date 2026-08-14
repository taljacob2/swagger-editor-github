import { getActiveTab, getTabContent, getWorkspaceMeta } from './workspace-tabs-service.js';

const afterLoad = (system) => {
  const { editorActions, editorSelectors, EditorContentOrigin } = system;

  const activeTab = getActiveTab(getWorkspaceMeta());
  const content = getTabContent(activeTab.id);

  if (editorSelectors.selectContent() === content) return; // content already loaded

  editorActions.setContent(content, EditorContentOrigin.LocalStorage);
};

export default afterLoad;
