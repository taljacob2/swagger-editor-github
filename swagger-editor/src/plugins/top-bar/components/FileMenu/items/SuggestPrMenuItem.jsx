import PropTypes from 'prop-types';

const SuggestPrMenuItem = ({ getComponent, onClick, children = null }) => {
  const DropdownMenuItem = getComponent('DropdownMenuItem');

  return (
    <DropdownMenuItem onClick={onClick}>{children || 'Suggest pull request…'}</DropdownMenuItem>
  );
};

SuggestPrMenuItem.propTypes = {
  getComponent: PropTypes.func.isRequired,
  children: PropTypes.node,
  onClick: PropTypes.func.isRequired,
};

export default SuggestPrMenuItem;
