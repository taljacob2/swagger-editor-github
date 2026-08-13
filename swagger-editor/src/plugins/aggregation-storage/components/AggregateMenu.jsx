import { useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import AggregateMenuHandler from './AggregateMenuHandler.jsx';

const AggregateMenu = (props) => {
  const { getComponent } = props;
  const aggregateMenuHandler = useRef(null);
  const DropdownMenu = getComponent('DropdownMenu');
  const DropdownMenuItem = getComponent('DropdownMenuItem');

  const handleManageSetsClick = useCallback(() => {
    aggregateMenuHandler.current.openModal();
  }, []);

  return (
    <>
      {/* eslint-disable-next-line react/jsx-props-no-spreading */}
      <AggregateMenuHandler {...props} ref={aggregateMenuHandler} />
      <DropdownMenu label="Aggregate">
        <DropdownMenuItem onClick={handleManageSetsClick}>Manage Sets…</DropdownMenuItem>
      </DropdownMenu>
    </>
  );
};

AggregateMenu.propTypes = {
  getComponent: PropTypes.func.isRequired,
};

export default AggregateMenu;
