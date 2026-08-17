import { useState, useEffect } from 'react';

// Keep in sync with $mobile-breakpoint in src/styles/_globals.scss -- this is
// the one layout change (SplitPane orientation) that's a React prop, not
// CSS, so it needs the same threshold available in JS.
export const MOBILE_BREAKPOINT_PX = 600;

export default function useIsMobile() {
  const query = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;
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
