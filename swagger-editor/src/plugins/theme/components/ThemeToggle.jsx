import PropTypes from 'prop-types';
import { SunIcon, MoonIcon, DeviceDesktopIcon } from '@primer/octicons-react';

// light -> dark -> system -> light ...
const NEXT_MODE = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const MODE_ICON = {
  light: SunIcon,
  dark: MoonIcon,
  system: DeviceDesktopIcon,
};

const MODE_LABEL = {
  light: 'Light theme',
  dark: 'Dark theme',
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
