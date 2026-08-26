import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import useOverflowCompact from '../../../layout/hooks/useOverflowCompact.js';

/* eslint-disable */

const TopBar = ({ getComponent }) => {
  const Logo = getComponent('TopBarLogo');
  const FileMenu = getComponent('TopBarFileMenu', true);
  const EditMenu = getComponent('TopBarEditMenu', true);
  const OpenAPI3GenerateServerMenu = getComponent('TopBarOpenAPI3GenerateServerMenu', true);
  const OpenAPI3GenerateClientMenu = getComponent('TopBarOpenAPI3GenerateClientMenu', true);
  const OpenAPI2GenerateServerMenu = getComponent('TopBarOpenAPI2GenerateServerMenu', true);
  const OpenAPI2GenerateClientMenu = getComponent('TopBarOpenAPI2GenerateClientMenu', true);
  const AggregateMenu = getComponent('TopBarAggregateMenu', true);
  const GitHubMenu = getComponent('TopBarGitHubMenu', true);
  const AboutMenu = getComponent('TopBarAboutMenu', true);
  const ThemeToggle = getComponent('ThemeToggle', true);

  // Whether the full row of menus fits is content-dependent (how many
  // Generate Server/Client variants are showing for the current spec
  // version, font rendering, zoom...), so this is measured directly rather
  // than guessed at a static breakpoint -- containerRef/measureRef are
  // wired into the JSX below.
  const { containerRef, measureRef, isCompact } = useOverflowCompact();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Crossing the fit threshold mid-session (resizing the window) shouldn't
  // leave a stale open/closed hamburger state behind.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [isCompact]);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen, containerRef]);

  const menuItems = (
    <>
      <FileMenu />
      <EditMenu />
      <OpenAPI3GenerateServerMenu />
      <OpenAPI3GenerateClientMenu />
      <OpenAPI2GenerateServerMenu />
      <OpenAPI2GenerateClientMenu />
      <AggregateMenu />
      <GitHubMenu />
      <AboutMenu />
    </>
  );

  return (
    <div
      className={classNames('swagger-editor__top-bar', {
        'swagger-editor__top-bar--compact': isCompact,
      })}
      ref={containerRef}
    >
      {/* Invisible, always-mounted copy of the full row, purely so
          useOverflowCompact can measure how wide it actually wants to be.
          Reuses -row/-wrapper's exact classes (not a bespoke one) so it
          picks up the same per-item margins the real row renders with --
          a from-scratch measurement container under-measured by missing
          those, reporting a narrower "natural" width than the row
          actually needs and letting it overflow anyway.
          Two nested layers, not one: the outer one clips to 0x0 so this
          never affects page scroll, and the inner one (measureRef) is its
          own position: absolute box so *its* size stays content-driven
          instead of being squashed to 0 by the outer clip -- ResizeObserver
          watches the inner box, and a permanently-0x0 box can never report
          a size change even when what's inside it does (e.g. a web font
          finishing its async load). */}
      <div className="swagger-editor__top-bar-measure-clip" aria-hidden="true">
        <div className="swagger-editor__top-bar-measure" ref={measureRef}>
          <div className="swagger-editor__top-bar-row">
            <Logo />
          </div>
          <div className="swagger-editor__top-bar-wrapper">{menuItems}</div>
        </div>
      </div>
      <div className="swagger-editor__top-bar-row">
        <Logo />
        <div className="swagger-editor__top-bar-row-end">
          <ThemeToggle />
          {isCompact && (
            <button
              type="button"
              className="swagger-editor__top-bar-hamburger"
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </div>
      {(!isCompact || isMenuOpen) && (
        <div
          className={classNames('swagger-editor__top-bar-wrapper', {
            'swagger-editor__top-bar-wrapper--compact': isCompact,
          })}
        >
          {menuItems}
        </div>
      )}
    </div>
  );
};

TopBar.propTypes = {
  getComponent: PropTypes.func.isRequired,
};

export default TopBar;
