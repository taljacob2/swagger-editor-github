import PropTypes from 'prop-types';
import { SunIcon, MoonIcon, ColumnsIcon, DeviceDesktopIcon } from '@primer/octicons-react';

// light -> semi-dark -> dark -> system -> light ...
const NEXT_MODE = {
  light: 'semi-dark',
  'semi-dark': 'dark',
  dark: 'system',
  system: 'light',
};

const MODE_ICON = {
  light: SunIcon,
  dark: MoonIcon,
  // Split-pane glyph -- 'semi-dark' is the one mode where the editor and
  // preview pane genuinely disagree (editor dark, preview light), unlike
  // every other mode where a single icon can stand for the whole app.
  'semi-dark': ColumnsIcon,
  system: DeviceDesktopIcon,
};

const MODE_LABEL = {
  light: 'Light theme',
  dark: 'Dark theme',
  'semi-dark': 'Semi-dark theme (dark editor, light preview)',
  system: 'System default theme',
};

const ThemeToggle = ({ editorSelectors, editorActions }) => {
  const mode = editorSelectors.selectThemeMode();
  const Icon = MODE_ICON[mode];

  const handleClick = () => {
    editorActions.setThemeMode(NEXT_MODE[mode]);
  };

  return (
    <button
      type="button"
      className="swagger-editor__top-bar-theme-toggle"
      onClick={handleClick}
      aria-label={`${MODE_LABEL[mode]} (click to switch to ${MODE_LABEL[NEXT_MODE[mode]].toLowerCase()})`}
      title={MODE_LABEL[mode]}
    >
      <Icon size="small" aria-hidden="true" />
    </button>
  );
};

ThemeToggle.propTypes = {
  editorActions: PropTypes.shape({
    setThemeMode: PropTypes.func.isRequired,
  }).isRequired,
  editorSelectors: PropTypes.shape({
    selectThemeMode: PropTypes.func.isRequired,
  }).isRequired,
};

export default ThemeToggle;
