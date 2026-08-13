import React, { forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import { fireEvent, render, screen } from '@testing-library/react';

import AggregateMenu from './AggregateMenu.jsx';

const openModal = vi.fn();

vi.mock('./AggregateMenuHandler.jsx', () => ({
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

describe('AggregateMenu', () => {
  beforeEach(() => {
    openModal.mockClear();
  });

  test('renders an Aggregate dropdown with a Manage Sets item', () => {
    render(<AggregateMenu getComponent={getComponent} />);

    expect(screen.getByText('Aggregate')).toBeInTheDocument();
    expect(screen.getByText('Manage Sets…')).toBeInTheDocument();
  });

  test('clicking the menu item opens the manage-sets modal', () => {
    render(<AggregateMenu getComponent={getComponent} />);

    fireEvent.click(screen.getByText('Manage Sets…'));

    expect(openModal).toHaveBeenCalledTimes(1);
  });
});
