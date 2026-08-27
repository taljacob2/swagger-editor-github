import { createSelector } from 'reselect';

import { DEFAULT_THEME_MODE } from './theme-service.js';

export const selectThemeMode = (state) => state.get('themeMode') || DEFAULT_THEME_MODE;

export const selectSystemPrefersDark = (state) => state.get('systemPrefersDark') || false;

// Resolves 'system' (and 'semi-dark', see below) down to an actual
// 'light' | 'dark' for the CSS scope class -- everything *except* Monaco's
// own theme (modals, dropdown menus, tab bar, editor pane bar, validation
// table, and the swagger-ui-react/AsyncAPI/API Design Systems preview
// panes) reads this one. 'semi-dark' resolves to 'light' here: it only
// forces the *editor* dark (see selectResolvedEditorTheme below), so
// everything this selector drives stays exactly like 'light' mode.
export const selectResolvedTheme = createSelector(
  selectThemeMode,
  selectSystemPrefersDark,
  (mode, systemPrefersDark) => {
    if (mode === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    if (mode === 'semi-dark') {
      return 'light';
    }
    return mode;
  }
);

// Monaco's own resolved theme -- the one place 'semi-dark' actually means
// something different from 'light': the editor goes dark while everything
// selectResolvedTheme drives (chrome + preview pane) stays light.
export const selectResolvedEditorTheme = createSelector(
  selectThemeMode,
  selectSystemPrefersDark,
  (mode, systemPrefersDark) => {
    if (mode === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    if (mode === 'semi-dark') {
      return 'dark';
    }
    return mode;
  }
);
