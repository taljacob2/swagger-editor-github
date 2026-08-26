import { createSelector } from 'reselect';

import { DEFAULT_THEME_MODE } from './theme-service.js';

export const selectThemeMode = (state) => state.get('themeMode') || DEFAULT_THEME_MODE;

export const selectSystemPrefersDark = (state) => state.get('systemPrefersDark') || false;

// Resolves 'system' down to an actual 'light' | 'dark', the value every
// theme-consuming surface (CSS scope class, Monaco's theme prop) cares
// about -- callers never need to re-derive this themselves.
export const selectResolvedTheme = createSelector(
  selectThemeMode,
  selectSystemPrefersDark,
  (mode, systemPrefersDark) => {
    if (mode === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    return mode;
  }
);
