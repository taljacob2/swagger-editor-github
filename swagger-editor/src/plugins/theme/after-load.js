import { getStoredThemeMode } from './theme-service.js';

const afterLoad = (system) => {
  const { editorActions } = system;

  // Seeds the mode synchronously, before the layout ever mounts, so the
  // very first render already resolves to the right theme -- no flash of
  // the wrong theme to fade out of.
  editorActions.setThemeMode(getStoredThemeMode());
};

export default afterLoad;
