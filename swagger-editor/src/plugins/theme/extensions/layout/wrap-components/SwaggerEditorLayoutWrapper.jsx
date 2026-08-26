import { useEffect } from 'react';

/* eslint-disable react/jsx-props-no-spreading */

// Wraps the app's root layout in a scope element carrying the resolved
// theme -- everything CSS-var-themed (modals excluded: react-modal renders
// its portal as a DOM sibling of the app root, outside this subtree, so it
// gets the same dark-mode class a different way -- see modals/components/
// Modal.jsx's portalClassName) inherits from here. Also the single place
// that keeps the Monaco editor's own theme (already a first-class concept
// in editor-monaco, see themes/se-vs-dark.js/se-vs-light.js) in sync with
// the global theme, rather than duplicating theme-resolution logic at the
// editor layer.
const SwaggerEditorLayoutWrapper = (Original, system) => {
  const ThemedSwaggerEditorLayout = (props) => {
    const { editorSelectors, editorActions } = system;
    const resolvedTheme = editorSelectors.selectResolvedTheme();

    useEffect(() => {
      editorActions.setTheme?.(resolvedTheme === 'dark' ? 'se-vs-dark' : 'se-vs-light');
    }, [resolvedTheme, editorActions]);

    return (
      <div className="swagger-editor__theme-root" data-theme={resolvedTheme}>
        <Original {...props} />
      </div>
    );
  };

  return ThemedSwaggerEditorLayout;
};

export default SwaggerEditorLayoutWrapper;
