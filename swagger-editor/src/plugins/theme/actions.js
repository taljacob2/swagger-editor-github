import { saveThemeMode } from './theme-service.js';

/**
 * Action types.
 */
export const EDITOR_SET_THEME_MODE = 'editor_set_theme_mode';

/**
 * Action creators.
 */
export const setThemeMode = (mode) => {
  saveThemeMode(mode);
  return {
    type: EDITOR_SET_THEME_MODE,
    payload: mode,
  };
};
