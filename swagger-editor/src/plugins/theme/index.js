import ThemeToggle from './components/ThemeToggle.jsx';
import SwaggerEditorLayoutWrapper from './extensions/layout/wrap-components/SwaggerEditorLayoutWrapper.jsx';
import { setThemeMode, setSystemPrefersDark } from './actions.js';
import {
  selectThemeMode,
  selectSystemPrefersDark,
  selectResolvedTheme,
  selectResolvedEditorTheme,
} from './selectors.js';
import reducers from './reducers.js';
import afterLoad from './after-load.js';

const ThemePlugin = () => ({
  afterLoad,
  components: {
    ThemeToggle,
  },
  wrapComponents: {
    SwaggerEditorLayout: SwaggerEditorLayoutWrapper,
  },
  statePlugins: {
    editor: {
      actions: {
        setThemeMode,
        setSystemPrefersDark,
      },
      reducers,
      selectors: {
        selectThemeMode,
        selectSystemPrefersDark,
        selectResolvedTheme,
        selectResolvedEditorTheme,
      },
    },
  },
});

export default ThemePlugin;
