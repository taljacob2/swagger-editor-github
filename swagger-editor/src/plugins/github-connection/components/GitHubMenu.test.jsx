import React, { forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import { fireEvent, render, screen } from '@testing-library/react';

import GitHubMenu from './GitHubMenu.jsx';

const openModal = vi.fn();

vi.mock('./GitHubMenuHandler.jsx', () => ({
  default: forwardRef((props, ref) => {
    useImperativeHandle(ref, () => ({ openModal }));
    return null;
  }),
}));

const DropdownMenu = ({ label, children }) => (
  <div>
    <span>{label}</span>
    {children}
  </div>
);
DropdownMenu.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

const DropdownMenuItem = ({ onClick, children }) => (
  <button type="button" onClick={onClick}>
    {children}
  </button>
);
DropdownMenuItem.propTypes = {
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

const stubComponents = { DropdownMenu, DropdownMenuItem };
const getComponent = (name) => stubComponents[name];

describe('GitHubMenu', () => {
  beforeEach(() => {
    openModal.mockClear();
  });

  test('renders a GitHub dropdown with a Connection Settings item', () => {
    render(<GitHubMenu getComponent={getComponent} />);

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Connection Settings…')).toBeInTheDocument();
  });

  test('clicking the menu item opens the connection settings modal', () => {
    render(<GitHubMenu getComponent={getComponent} />);

    fireEvent.click(screen.getByText('Connection Settings…'));

    expect(openModal).toHaveBeenCalledTimes(1);
  });
});
