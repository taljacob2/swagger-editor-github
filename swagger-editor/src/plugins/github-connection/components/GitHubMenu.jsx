import { useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import GitHubMenuHandler from './GitHubMenuHandler.jsx';

const GitHubMenu = (props) => {
  const { getComponent } = props;
  const githubMenuHandler = useRef(null);
  const DropdownMenu = getComponent('DropdownMenu', true);
  const DropdownMenuItem = getComponent('DropdownMenuItem');

  const handleConnectionSettingsClick = useCallback(() => {
    githubMenuHandler.current.openModal();
  }, []);

  return (
    <>
      {/* eslint-disable-next-line react/jsx-props-no-spreading */}
      <GitHubMenuHandler {...props} ref={githubMenuHandler} />
      <DropdownMenu label="GitHub">
        <DropdownMenuItem onClick={handleConnectionSettingsClick}>
          Connection Settings…
        </DropdownMenuItem>
      </DropdownMenu>
    </>
  );
};

GitHubMenu.propTypes = {
  getComponent: PropTypes.func.isRequired,
};

export default GitHubMenu;
