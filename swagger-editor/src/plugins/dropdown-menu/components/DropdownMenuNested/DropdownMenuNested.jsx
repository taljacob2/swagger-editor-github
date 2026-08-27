import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

const DropdownMenuNested = ({ children = [], label, isLong = false }) => {
  const ref = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = () => {
    setIsOpen(true);
  };
  const handleClose = () => {
    setIsOpen(false);
  };
  // mouseenter/mouseleave never fire on touch devices, so a tap alone could
  // never open this submenu without this -- click-to-toggle covers touch
  // (and mouse) at any viewport size.
  const handleToggleClick = (event) => {
    event.stopPropagation();
    setIsOpen((open) => !open);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current !== null && !ref.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <li
      ref={ref}
      className={classNames('nested-dd-menu nested-reverse', { long: isLong })}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
    >
      {/* Named for tests/CSS to target the trigger specifically -- since
          the "‹ Back" header below repeats the same label text, plain
          text queries (e.g. testing-library's getByText) now match both. */}
      <button type="button" className="nested-dd-menu-trigger" onClick={handleToggleClick}>
        {label}&nbsp;&nbsp;<b>&gt;</b>
      </button>
      {/* Always mounted (not conditional on isOpen) so compact mode (see
          _dropdown-menu.scss) can transition it in as a sliding full-panel
          screen -- same reasoning as DropdownMenu.jsx's own dd-menu-items.
          `dd-item-ignore` itself is a marker the base dd-menu library CSS
          already keys off (excludes this from the plain-row padding it
          gives every other `li > *`); the open state gets its own
          modifier class alongside it. */}
      <span
        className={classNames('dd-item-ignore', { 'dd-item-ignore--open': isOpen })}
        aria-hidden={!isOpen || undefined}
        inert={!isOpen ? '' : undefined}
      >
        <button
          type="button"
          className="dd-menu-items__back"
          onClick={(event) => {
            event.stopPropagation();
            handleClose();
          }}
        >
          <span aria-hidden="true">‹</span> {label}
        </button>
        <ul>{children}</ul>
      </span>
    </li>
  );
};

DropdownMenuNested.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.oneOfType([PropTypes.array, PropTypes.element]),
  isLong: PropTypes.bool,
};

export default DropdownMenuNested;
