import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import DropdownMenuNested from './DropdownMenuNested.jsx';

describe('DropdownMenuNested', () => {
  // The panel is always mounted now (not conditionally rendered), so a
  // CSS transition can play it in/out in compact mode instead of just
  // popping in -- see DropdownMenuNested.jsx's comment. Open/closed is
  // then a matter of the aria-hidden/inert state on its wrapper, not DOM
  // presence, so these tests check that instead of toBeInTheDocument().
  const panel = () => document.querySelector('.dd-item-ignore');

  test('clicking the label toggles the submenu open and closed', () => {
    render(
      <ul>
        <DropdownMenuNested label="Load Example">
          <li>Option A</li>
        </DropdownMenuNested>
      </ul>
    );

    expect(panel()).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByText('Load Example', { selector: '.nested-dd-menu-trigger' }));
    expect(panel()).not.toHaveAttribute('aria-hidden');
    expect(screen.getByText('Option A')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Load Example', { selector: '.nested-dd-menu-trigger' }));
    expect(panel()).toHaveAttribute('aria-hidden', 'true');
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

    fireEvent.click(screen.getByText('Load Example', { selector: '.nested-dd-menu-trigger' }));
    expect(panel()).not.toHaveAttribute('aria-hidden');

    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(panel()).toHaveAttribute('aria-hidden', 'true');
  });
});
