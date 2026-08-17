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
      <button type="button" onClick={handleToggleClick}>
        {label}&nbsp;&nbsp;<b>&gt;</b>
      </button>
      <span className="dd-item-ignore">{isOpen && <ul>{children}</ul>}</span>
    </li>
  );
};

DropdownMenuNested.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.oneOfType([PropTypes.array, PropTypes.element]),
  isLong: PropTypes.bool,
};

export default DropdownMenuNested;
