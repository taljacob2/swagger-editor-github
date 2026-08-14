import { createSafeActionWrapper } from '../../../util/fn.js';
import { getWorkspace, saveWorkspace, updateTabContent } from '../../workspace-tabs-service.js';

// eslint-disable-next-line import/prefer-default-export
export const setContent = createSafeActionWrapper((oriAction, system) => (content) => {
  const { editorSelectors, EditorContentOrigin } = system;

  const contentOrigin = editorSelectors.selectContentOrigin();
  const skipOrigins = [EditorContentOrigin.Props, EditorContentOrigin.InitialFixtureLoad];

  if (skipOrigins.includes(contentOrigin)) {
    return;
  }

  const workspace = getWorkspace();
  saveWorkspace(updateTabContent(workspace, workspace.activeTabId, content));
});
