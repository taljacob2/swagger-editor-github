import { useState, useRef, useEffect } from 'react';

// Whether a row of content actually fits its available width is content-
// dependent (how many menu variants are showing, font rendering, browser
// zoom, OS...) -- no single static breakpoint gets this right for every
// combination. Measure it directly instead: attach containerRef to the
// element whose available width matters, and measureRef to an always-
// mounted (but invisible) copy of the full-width content; isCompact flips
// true only once the measured content genuinely doesn't fit.
export default function useOverflowCompact() {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const containerEl = containerRef.current;
    const measureEl = measureRef.current;
    if (!containerEl || !measureEl) {
      return undefined;
    }

    const checkFit = () => {
      setIsCompact(measureEl.scrollWidth > containerEl.clientWidth);
    };

    checkFit();
    const observer = new ResizeObserver(checkFit);
    // Both, not just the container: the container can stay the same size
    // while the *measured content* changes width on its own (e.g. a web
    // font finishing its async load after the very first, pre-font-load
    // measurement) -- observing only the container misses that entirely,
    // leaving isCompact stuck on a stale, too-narrow initial reading.
    observer.observe(containerEl);
    observer.observe(measureEl);
    return () => observer.disconnect();
  }, []);

  return { containerRef, measureRef, isCompact };
}
