import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import DropdownMenuNested from './DropdownMenuNested.jsx';

describe('DropdownMenuNested', () => {
  test('clicking the label toggles the submenu open and closed', () => {
    render(
      <ul>
        <DropdownMenuNested label="Load Example">
          <li>Option A</li>
        </DropdownMenuNested>
      </ul>
    );

    expect(screen.queryByText('Option A')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Load Example'));
    expect(screen.getByText('Option A')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Load Example'));
    expect(screen.queryByText('Option A')).not.toBeInTheDocument();
  });

  test('clicking outside the submenu closes it', () => {
    render(
      <div>
        <ul>
          <DropdownMenuNested label="Load Example">
            <li>Option A</li>
          </DropdownMenuNested>
        </ul>
        <button type="button">Outside</button>
      </div>
    );

    fireEvent.click(screen.getByText('Load Example'));
    expect(screen.getByText('Option A')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(screen.queryByText('Option A')).not.toBeInTheDocument();
  });
});
