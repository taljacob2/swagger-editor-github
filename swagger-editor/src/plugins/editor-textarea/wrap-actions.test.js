import {
  setContentDebounced,
  setContentDebouncedImpl,
  flushPendingSetContent,
} from './wrap-actions.js';

describe('setContentDebouncedImpl / flushPendingSetContent', () => {
  afterEach(() => {
    // These wrap a real (non-mocked) lodash debounce shared at module scope
    // -- flush any call a test scheduled so it can't leak into the next one.
    setContentDebouncedImpl.cancel();
  });

  test('flushPendingSetContent invokes a pending call immediately instead of waiting out the debounce window', () => {
    const setContent = vi.fn();
    const system = { editorActions: { setContent } };

    setContentDebounced(null, system)('new content', 'editor');
    expect(setContent).not.toHaveBeenCalled();

    flushPendingSetContent();

    expect(setContent).toHaveBeenCalledWith('new content', 'editor');
  });

  test('flushPendingSetContent is a no-op when nothing is pending', () => {
    expect(() => flushPendingSetContent()).not.toThrow();
  });
});
