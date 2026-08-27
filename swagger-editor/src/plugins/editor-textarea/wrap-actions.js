import debounce from 'lodash/debounce.js';

import { createSafeActionWrapper } from '../util/fn.js';

export const setContentDebouncedImpl = debounce((content, contentOrigin, system) => {
  system.editorActions.setContent(content, contentOrigin);
}, 500);

// setContentDebouncedImpl is a single module-level debounce shared by every
// tab (typing in any tab reschedules the same timer) -- so switching tabs
// while a keystroke from the *previous* tab is still pending would otherwise
// let that stale call fire after the switch and overwrite the newly-active
// tab's content/spec with the old tab's. Callers that change which tab is
// active (see TabBar's applyWorkspace) must flush this first, while the
// about-to-be-left tab is still the active one, so the pending write lands
// on it instead of whatever tab comes next.
export const flushPendingSetContent = () => {
  setContentDebouncedImpl.flush();
};

export const editorSetup = (oriAction) => (editorInstance, implementation) => {
  if (implementation !== 'monaco') {
    globalThis.editor = editorInstance;
    globalThis[implementation] = editorInstance;
  }

  return oriAction(editorInstance, implementation);
};

export const editorTearDown = (oriAction) => (editorInstance, implementation) => {
  if (implementation !== 'monaco') {
    delete globalThis.editor;
    delete globalThis[implementation];
  }

  return oriAction(editorInstance, implementation);
};

export const setContentDebounced = (oriAction, system) => (content, contentOrigin) => {
  setContentDebouncedImpl(content, contentOrigin, system);
};

export const clearContent = createSafeActionWrapper((oriAction, system) => () => {
  const { EditorContentOrigin } = system;

  system.editorActions.setContent('', EditorContentOrigin.Clear);
});
