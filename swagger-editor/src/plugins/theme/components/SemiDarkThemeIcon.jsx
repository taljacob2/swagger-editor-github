// A custom glyph -- @primer/octicons-react has no "half sun, half moon" icon,
// and nothing else in its set reads as "mixed" the way this needs to for
// semi-dark mode. Built to match octicons' own visual language (16x16,
// fill="currentColor", same wrapper attributes as SunIcon/MoonIcon) rather
// than pulling in a second icon library for one glyph.
//
// The sun half (left) is a thin circle outline (hollow/open reads as
// light); the moon half (right) is the same circle solid-filled (reads as
// dark) -- same convention as the classic "contrast" glyph, plus three
// short rays on the sun side so it still reads as sun-like rather than a
// generic contrast toggle.
//
// Takes no props: every call site passes octicons-style props (size="small",
// aria-hidden) meant for @primer/octicons-react's own components, which this
// one isn't -- those are simply dropped rather than threaded through, same
// visual result (16x16, hidden from the accessibility tree) either way.
const SemiDarkThemeIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="currentColor"
    display="inline-block"
    overflow="visible"
    style={{ verticalAlign: 'text-bottom' }}
  >
    {/* Circle outline -- visible as the open "sun" ring on the left; its
        right half is covered by the solid moon path below. */}
    <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="0.85" />
    {/* Moon half: solid filled semicircle, right side */}
    <path d="M8 4A4 4 0 0 1 8 12Z" />
    {/* Three short rays, sun side only */}
    <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="3" y1="8" x2="1.3" y2="8" />
      <line x1="4.465" y1="4.465" x2="3.263" y2="3.263" />
      <line x1="4.465" y1="11.535" x2="3.263" y2="12.737" />
    </g>
  </svg>
);

export default SemiDarkThemeIcon;
