const STORAGE_KEY = 'swagger-editor:theme-mode';

export const THEME_MODES = ['light', 'dark', 'system'];
export const DEFAULT_THEME_MODE = 'system';

export function getStoredThemeMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (THEME_MODES.includes(stored)) {
      return stored;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_THEME_MODE;
}

export function saveThemeMode(mode) {
  if (!THEME_MODES.includes(mode)) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.) --
    // the mode still applies for the current session via Redux state, it
    // just won't survive a reload.
  }
}

export function getSystemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
