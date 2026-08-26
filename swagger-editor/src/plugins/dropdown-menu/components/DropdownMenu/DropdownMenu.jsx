import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

/* eslint-disable jsx-a11y/click-events-have-key-events */

const VIEWPORT_MARGIN_PX = 16;

const DropdownMenu = ({ children = [], label, isLong = false, editorSelectors = null }) => {
  const isDark = editorSelectors?.selectResolvedTheme?.() === 'dark';
  const ref = useRef(null);
  const itemsRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  // Nudges the panel horizontally by exactly enough to bring it fully
  // on screen, computed from its own rendered (default left-anchored)
  // position -- a plain left/right anchor flip isn't enough on its own:
  // for a trigger in the middle of the row (Generate Server/Client, not at
  // either end), flipping a wide panel to right-anchored just moves the
  // overflow to the left edge instead of the right one it started at.
  // max-width: calc(100vw - 2rem) in the CSS guarantees the panel is never
  // wider than the two margins leave room for, so these two clamps (right
  // edge, then left edge) can never conflict with each other.
  const [shiftPx, setShiftPx] = useState(0);

  const handleClickOutside = (event) => {
    if (ref.current !== null && !ref.current.contains(event.target)) {
      setIsOpen(false);
    }
  };

  const handleToggleClick = () => {
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Runs before paint, so the shift (if any) is invisible -- the panel
  // never visibly renders in the overflowing position first. Re-measures
  // fresh every time it opens, since the window may have been resized
  // while it was closed.
  useLayoutEffect(() => {
    if (!isOpen || !itemsRef.current) {
      setShiftPx(0);
      return;
    }
    const rect = itemsRef.current.getBoundingClientRect();
    let shift = 0;
    if (rect.right + shift > window.innerWidth - VIEWPORT_MARGIN_PX) {
      shift = window.innerWidth - VIEWPORT_MARGIN_PX - rect.right;
    }
    if (rect.left + shift < VIEWPORT_MARGIN_PX) {
      shift = VIEWPORT_MARGIN_PX - rect.left;
    }
    setShiftPx(shift);
  }, [isOpen]);

  return (
    <div
      className={classNames('dd-menu dd-menu-left', { long: isLong, 'dd-menu-inverse': isDark })}
      ref={ref}
    >
      <span
        className="menu-item"
        role="button"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={handleToggleClick}
      >
        {label}
      </span>
      {isOpen && (
        <div
          className="dd-menu-items"
          aria-labelledby="Dropdown"
          onClick={handleToggleClick}
          role="menu"
          tabIndex={0}
          ref={itemsRef}
          style={shiftPx ? { transform: `translateX(${shiftPx}px)` } : undefined}
        >
          <ul className="dd-items-left">{children}</ul>
        </div>
      )}
    </div>
  );
};

DropdownMenu.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.oneOfType([PropTypes.array, PropTypes.element]),
  isLong: PropTypes.bool,
  editorSelectors: PropTypes.shape({
    selectResolvedTheme: PropTypes.func,
  }),
};

export default DropdownMenu;
