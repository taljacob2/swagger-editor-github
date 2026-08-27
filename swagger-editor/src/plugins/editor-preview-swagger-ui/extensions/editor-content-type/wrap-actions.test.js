import { detectContentTypeSuccess } from './wrap-actions.js';

const EditorContentOrigin = {
  Editor: 'editor',
  LocalStorage: 'local-storage',
  ImportUrl: 'import-url',
};

const makeSystem = ({ contentOrigin, isOpenAPI = true }) => ({
  specActions: { updateUrl: vi.fn(), updateSpec: vi.fn() },
  errActions: { clearBy: vi.fn() },
  editorSelectors: {
    selectContentOrigin: () => contentOrigin,
    selectIsContentTypeOpenAPI: () => isOpenAPI,
  },
  editorPreviewSwaggerUISelectors: { selectURL: () => 'https://example.com/spec.yaml' },
  EditorContentOrigin,
});

// origAction must return a fresh object each call -- createSafeActionWrapper
// compares by reference to skip a duplicate dispatch of the same FSA.
const origAction = (payload) => ({ type: 'editor_content_type_detect_success', payload });

describe('detectContentTypeSuccess', () => {
  test("clears stale resolver errors when content arrives from a source other than typing (regression: switching tabs used to leave the outgoing tab's resolver errors on screen forever)", () => {
    const system = makeSystem({ contentOrigin: EditorContentOrigin.LocalStorage });

    detectContentTypeSuccess(origAction, system)({ content: 'openapi: 3.0.0' });

    expect(system.errActions.clearBy).toHaveBeenCalledTimes(1);
    const keepPredicate = system.errActions.clearBy.mock.calls[0][0];
    expect(keepPredicate({ get: () => 'resolver' })).toBe(false);
    expect(keepPredicate({ get: () => 'parser' })).toBe(true);
    expect(keepPredicate({ get: () => 'fetch' })).toBe(true);
  });

  test('does not clear errors for ordinary typing in the same tab', () => {
    const system = makeSystem({ contentOrigin: EditorContentOrigin.Editor });

    detectContentTypeSuccess(origAction, system)({ content: 'openapi: 3.0.0' });

    expect(system.errActions.clearBy).not.toHaveBeenCalled();
  });

  test('still updates the spec after clearing stale resolver errors', () => {
    const system = makeSystem({ contentOrigin: EditorContentOrigin.LocalStorage });

    detectContentTypeSuccess(origAction, system)({ content: 'openapi: 3.0.0' });

    expect(system.specActions.updateSpec).toHaveBeenCalledWith(
      'openapi: 3.0.0',
      EditorContentOrigin.Editor
    );
  });

  test('does not clear errors when the content type is not OpenAPI', () => {
    const system = makeSystem({
      contentOrigin: EditorContentOrigin.LocalStorage,
      isOpenAPI: false,
    });

    detectContentTypeSuccess(origAction, system)({ content: 'asyncapi: 3.0.0' });

    expect(system.errActions.clearBy).not.toHaveBeenCalled();
    expect(system.specActions.updateSpec).not.toHaveBeenCalled();
  });
});
