import { createSafeActionWrapper } from '../../../util/fn.js';

// eslint-disable-next-line import/prefer-default-export
export const detectContentTypeSuccess = createSafeActionWrapper(
  (oriAction, system) =>
    ({ content }) => {
      const {
        specActions,
        errActions,
        editorSelectors,
        editorPreviewSwaggerUISelectors,
        EditorContentOrigin,
      } = system;

      const contentOrigin = editorSelectors.selectContentOrigin();

      // all content in editor was deleted
      if (contentOrigin === EditorContentOrigin.Editor && !content.trim()) {
        specActions.updateUrl('');
      }

      if (editorSelectors.selectIsContentTypeOpenAPI()) {
        if (contentOrigin === EditorContentOrigin.ImportUrl) {
          specActions.updateUrl(editorPreviewSwaggerUISelectors.selectURL());
        } else if (contentOrigin !== EditorContentOrigin.Editor) {
          specActions.updateUrl('');
        }

        // swagger-ui-react's "Errors" panel is fed by an err-plugin list
        // that only ever gets *appended* to. Its own clearBy for a given
        // path only runs when something actually re-resolves that path --
        // which only happens for an operation currently expanded on
        // screen. So switching to a whole different document (a tab
        // switch, an Import URL, ...) while the erroring operation from
        // the *previous* document isn't expanded here leaves those
        // resolver errors sitting in the list forever, since nothing
        // about the new document ever re-resolves that same path to
        // clear them. Parser/fetch/auth errors don't have this problem --
        // swagger-ui-react already clears each of those unconditionally
        // at the point they'd be produced again -- resolver errors are
        // the one category with no such unconditional clear, so they're
        // the one we have to clear ourselves. Scoped to non-Editor origins
        // (i.e. the document was swapped wholesale, not typed) so normal
        // same-tab typing keeps relying on swagger-ui-react's own
        // re-resolve-on-expand behavior without an extra clear/flicker.
        if (contentOrigin !== EditorContentOrigin.Editor) {
          errActions.clearBy((error) => error.get('source') !== 'resolver');
        }

        specActions.updateSpec(content, EditorContentOrigin.Editor);
      }
    }
);
