import { getStoredThemeMode, getSystemPrefersDark } from './theme-service.js';

const afterLoad = (system) => {
  const { editorActions } = system;

  // Seeds both values synchronously, before the layout ever mounts, so the
  // very first render already resolves to the right theme -- no flash of
  // the wrong theme to fade out of.
  editorActions.setThemeMode(getStoredThemeMode());
  editorActions.setSystemPrefersDark(getSystemPrefersDark());

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = (event) => {
    editorActions.setSystemPrefersDark(event.matches);
  };

  // addEventListener is the modern API; addListener is the deprecated
  // fallback still needed by older WebKit/Safari builds.
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleChange);
  }
};

export default afterLoad;
