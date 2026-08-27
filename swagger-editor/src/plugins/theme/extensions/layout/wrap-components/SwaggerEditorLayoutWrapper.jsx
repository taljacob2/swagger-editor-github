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
//
// Two separate resolved-theme selectors, not one: 'semi-dark' mode forces
// the editor dark while leaving chrome + the preview pane light, so the
// scope element's data-theme (and the dark-mode class below, which only
// ever affects the preview pane) tracks selectResolvedTheme, while
// Monaco's own theme tracks selectResolvedEditorTheme -- for every other
// mode the two agree, so this split is a no-op everywhere except
// 'semi-dark'.
const SwaggerEditorLayoutWrapper = (Original, system) => {
  const ThemedSwaggerEditorLayout = (props) => {
    const { editorSelectors, editorActions } = system;
    const resolvedTheme = editorSelectors.selectResolvedTheme();
    const resolvedEditorTheme = editorSelectors.selectResolvedEditorTheme();

    useEffect(() => {
      editorActions.setTheme?.(resolvedEditorTheme === 'dark' ? 'se-vs-dark' : 'se-vs-light');
    }, [resolvedEditorTheme, editorActions]);

    // swagger-ui-react ships its own complete dark theme (see swagger-ui.css's
    // `html.dark-mode .swagger-ui { ... }` rules) gated on this class on
    // <html> -- not just an ancestor of .swagger-ui, the selector requires it
    // specifically on the root element, so there's no lower-DOM way to scope
    // it. Safe to toggle globally regardless: every one of those rules also
    // requires a .swagger-ui descendant, so it's a no-op anywhere else on a
    // host page this component is embedded into.
    useEffect(() => {
      document.documentElement.classList.toggle('dark-mode', resolvedTheme === 'dark');
      return () => document.documentElement.classList.remove('dark-mode');
    }, [resolvedTheme]);

    return (
      <div className="swagger-editor__theme-root" data-theme={resolvedTheme}>
        <Original {...props} />
      </div>
    );
  };

  return ThemedSwaggerEditorLayout;
};

export default SwaggerEditorLayoutWrapper;
