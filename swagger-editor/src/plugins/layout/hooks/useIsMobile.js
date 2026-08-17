import { useState, useEffect } from 'react';

// Keep in sync with $mobile-breakpoint in src/styles/_globals.scss -- this is
// the one layout change (SplitPane orientation) that's a React prop, not
// CSS, so it needs the same threshold available in JS.
export const MOBILE_BREAKPOINT_PX = 600;

// Keep in sync with $topbar-breakpoint in src/styles/_globals.scss -- the
// top bar's hamburger-vs-full-row decision is also a React prop, driven by
// its own wider breakpoint (see that file for why it differs from the one
// above).
export const TOPBAR_BREAKPOINT_PX = 1100;

export default function useIsMobile(breakpointPx = MOBILE_BREAKPOINT_PX) {
  const query = `(max-width: ${breakpointPx}px)`;
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const handleChange = (event) => setIsMobile(event.matches);
    mediaQueryList.addEventListener('change', handleChange);
    setIsMobile(mediaQueryList.matches);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, [query]);

  return isMobile;
}
