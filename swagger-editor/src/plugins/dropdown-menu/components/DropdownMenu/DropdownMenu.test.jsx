import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import DropdownMenu from './DropdownMenu.jsx';

describe('DropdownMenu', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    window.innerWidth = originalInnerWidth;
  });

  const stubItemsRect = (rect) => {
    Element.prototype.getBoundingClientRect = function stubRect() {
      if (this.classList.contains('dd-menu-items')) {
        return { top: 0, bottom: 0, height: 0, width: rect.right - rect.left, ...rect };
      }
      return { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0 };
    };
  };

  test('applies no shift when the panel fits within the viewport at its default position', () => {
    window.innerWidth = 1000;
    stubItemsRect({ left: 100, right: 400 });

    render(
      <DropdownMenu label="File">
        <li>Item</li>
      </DropdownMenu>
    );
    fireEvent.click(screen.getByText('File'));

    const items = document.querySelector('.dd-menu-items');
    expect(items.style.transform).toBe('');
  });

  test('shifts left when the panel would overflow the right edge', () => {
    // Simulates the "Generate Client" case: a wide (.long, 700px) panel
    // whose default left-anchored position pushes its right edge past the
    // viewport even though the top-bar row itself fits.
    window.innerWidth = 920;
    stubItemsRect({ left: 459, right: 1159 });

    render(
      <DropdownMenu label="Generate Client" isLong>
        <li>csharp</li>
      </DropdownMenu>
    );
    fireEvent.click(screen.getByText('Generate Client'));

    const items = document.querySelector('.dd-menu-items');
    // Right edge (1159) should land at 920 - 16 = 904, a -255px shift.
    expect(items.style.transform).toBe('translateX(-255px)');
  });

  test('does not let a right-edge fix push the panel past the left edge', () => {
    // A trigger close enough to the left edge that shifting purely to fix
    // the right overflow would send the left edge negative -- the left
    // clamp must win instead, even though the panel still can't fully
    // avoid the right edge (that's what the CSS max-width cap is for).
    window.innerWidth = 500;
    stubItemsRect({ left: 50, right: 750 });

    render(
      <DropdownMenu label="Generate Client" isLong>
        <li>csharp</li>
      </DropdownMenu>
    );
    fireEvent.click(screen.getByText('Generate Client'));

    const items = document.querySelector('.dd-menu-items');
    // Left edge (50) should land at exactly the 16px margin: a +(-34)px,
    // i.e. -34px shift -- not the larger leftward shift the right-edge fix
    // alone would have applied.
    expect(items.style.transform).toBe('translateX(-34px)');
  });

  test('re-measures fresh each time it reopens', () => {
    stubItemsRect({ left: 100, right: 400 });

    render(
      <DropdownMenu label="File">
        <li>Item</li>
      </DropdownMenu>
    );

    window.innerWidth = 350;
    fireEvent.click(screen.getByText('File'));
    expect(document.querySelector('.dd-menu-items').style.transform).not.toBe('');

    fireEvent.click(screen.getByText('File'));
    window.innerWidth = 1000;
    fireEvent.click(screen.getByText('File'));
    expect(document.querySelector('.dd-menu-items').style.transform).toBe('');
  });
});
