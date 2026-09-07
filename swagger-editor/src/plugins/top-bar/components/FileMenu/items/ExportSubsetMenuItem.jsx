import PropTypes from 'prop-types';

const ExportSubsetMenuItem = ({ getComponent, editorSelectors, onClick, children = null }) => {
  const DropdownMenuItem = getComponent('DropdownMenuItem');
  const isContentTypeOpenAPI = editorSelectors.selectIsContentTypeOpenAPI();

  return isContentTypeOpenAPI ? (
    <DropdownMenuItem onClick={onClick}>{children || 'Export Subset…'}</DropdownMenuItem>
  ) : null;
};

ExportSubsetMenuItem.propTypes = {
  getComponent: PropTypes.func.isRequired,
  editorSelectors: PropTypes.shape({
    selectIsContentTypeOpenAPI: PropTypes.func.isRequired,
  }).isRequired,
  children: PropTypes.node,
  onClick: PropTypes.func.isRequired,
};

export default ExportSubsetMenuItem;
