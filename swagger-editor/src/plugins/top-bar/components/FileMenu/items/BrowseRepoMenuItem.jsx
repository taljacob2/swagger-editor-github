import PropTypes from 'prop-types';

const BrowseRepoMenuItem = ({ getComponent, onClick, children = null }) => {
  const DropdownMenuItem = getComponent('DropdownMenuItem');

  return (
    <DropdownMenuItem onClick={onClick}>
      {children || 'Browse GitHub repositories…'}
    </DropdownMenuItem>
  );
};

BrowseRepoMenuItem.propTypes = {
  getComponent: PropTypes.func.isRequired,
  children: PropTypes.node,
  onClick: PropTypes.func.isRequired,
};

export default BrowseRepoMenuItem;
