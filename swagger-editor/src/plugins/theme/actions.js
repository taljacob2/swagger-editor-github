import { saveThemeMode } from './theme-service.js';

/**
 * Action types.
 */
export const EDITOR_SET_THEME_MODE = 'editor_set_theme_mode';
export const EDITOR_SET_SYSTEM_PREFERS_DARK = 'editor_set_system_prefers_dark';

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

export const setSystemPrefersDark = (prefersDark) => ({
  type: EDITOR_SET_SYSTEM_PREFERS_DARK,
  payload: prefersDark,
});
