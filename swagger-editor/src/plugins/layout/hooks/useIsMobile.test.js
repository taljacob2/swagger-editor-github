import { renderHook, act } from '@testing-library/react';

import useIsMobile, { MOBILE_BREAKPOINT_PX } from './useIsMobile.js';

function mockMatchMedia(initialMatches) {
  const listeners = new Set();
  let matches = initialMatches;
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    query,
    get matches() {
      return matches;
    },
    addEventListener: (event, listener) => listeners.add(listener),
    removeEventListener: (event, listener) => listeners.delete(listener),
  }));
  return {
    setMatches: (next) => {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test('reflects the initial match state', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  test('updates when the media query change event fires', () => {
    const { setMatches } = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setMatches(true);
    });

    expect(result.current).toBe(true);
  });

  test('queries against the documented breakpoint', () => {
    mockMatchMedia(false);
    renderHook(() => useIsMobile());
    expect(window.matchMedia).toHaveBeenCalledWith(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  });
});
