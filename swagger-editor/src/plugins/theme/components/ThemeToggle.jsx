import PropTypes from 'prop-types';
import { SunIcon, MoonIcon } from '@primer/octicons-react';

import SemiDarkThemeIcon from './SemiDarkThemeIcon.jsx';

// Fixed left-to-right order of the segmented control -- also the source of
// truth for the sliding highlight's position (its index into this array).
const MODES = ['light', 'semi-dark', 'dark'];

const MODE_ICON = {
  light: SunIcon,
  // Half-sun-half-moon glyph -- 'semi-dark' is the one mode where the
  // editor and preview pane genuinely disagree (editor dark, preview
  // light), unlike 'light'/'dark' where a single icon can stand for the
  // whole app.
  'semi-dark': SemiDarkThemeIcon,
  dark: MoonIcon,
};

const MODE_LABEL = {
  light: 'Light theme',
  'semi-dark': 'Semi-dark theme (dark editor, light preview)',
  dark: 'Dark theme',
};

// A 3-way segmented pill (all options visible, sliding highlight behind the
// active one) rather than a single button that cycles -- picking a mode
// directly beats clicking through up to two others to reach it, and this
// is the same pattern macOS' own Appearance setting (Light/Dark/Auto) and
// most modern design systems' ToggleGroup use for a small fixed set of
// mutually-exclusive options.
const ThemeToggle = ({ editorSelectors, editorActions }) => {
  const mode = editorSelectors.selectThemeMode();
  const activeIndex = MODES.indexOf(mode);

  return (
    <div className="swagger-editor__top-bar-theme-toggle" role="radiogroup" aria-label="Theme">
      <span
        className="swagger-editor__top-bar-theme-toggle-highlight"
        style={{ '--se-theme-toggle-index': activeIndex }}
        aria-hidden="true"
      />
      {MODES.map((option) => {
        const Icon = MODE_ICON[option];
        const isActive = option === mode;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={MODE_LABEL[option]}
            title={MODE_LABEL[option]}
            data-mode={option}
            className="swagger-editor__top-bar-theme-toggle-option"
            onClick={() => editorActions.setThemeMode(option)}
          >
            <Icon size="small" aria-hidden="true" />
          </button>
        );
      })}
    </div>
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
