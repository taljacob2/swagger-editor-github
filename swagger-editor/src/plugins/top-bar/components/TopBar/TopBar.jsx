import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import useIsMobile from '../../../layout/hooks/useIsMobile.js';

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

  const isMobile = useIsMobile();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const rootRef = useRef(null);

  // Crossing the breakpoint mid-session (e.g. rotating a tablet) shouldn't
  // leave a stale open/closed hamburger state behind.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }
    const handleClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  return (
    <div className="swagger-editor__top-bar" ref={rootRef}>
      <div className="swagger-editor__top-bar-row">
        <Logo />
        {isMobile && (
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
      {(!isMobile || isMenuOpen) && (
        <div
          className={classNames('swagger-editor__top-bar-wrapper', {
            'swagger-editor__top-bar-wrapper--mobile': isMobile,
          })}
        >
          <FileMenu />
          <EditMenu />
          <OpenAPI3GenerateServerMenu />
          <OpenAPI3GenerateClientMenu />
          <OpenAPI2GenerateServerMenu />
          <OpenAPI2GenerateClientMenu />
          <AggregateMenu />
          <GitHubMenu />
          <AboutMenu />
        </div>
      )}
    </div>
  );
};

TopBar.propTypes = {
  getComponent: PropTypes.func.isRequired,
};

export default TopBar;
