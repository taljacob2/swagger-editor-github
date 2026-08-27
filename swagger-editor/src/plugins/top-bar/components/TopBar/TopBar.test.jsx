import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import TopBar from './TopBar.jsx';

class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  // eslint-disable-next-line class-methods-use-this
  observe() {}

  // eslint-disable-next-line class-methods-use-this
  disconnect() {}
}
MockResizeObserver.instances = [];

const StubMenu = (label) => {
  const Component = () => <span>{label}</span>;
  Component.displayName = label;
  return Component;
};

const stubComponents = {
  TopBarLogo: StubMenu('Logo'),
  TopBarFileMenu: StubMenu('File'),
  TopBarEditMenu: StubMenu('Edit'),
  TopBarOpenAPI3GenerateServerMenu: StubMenu('OpenAPI3GenerateServer'),
  TopBarOpenAPI3GenerateClientMenu: StubMenu('OpenAPI3GenerateClient'),
  TopBarOpenAPI2GenerateServerMenu: StubMenu('OpenAPI2GenerateServer'),
  TopBarOpenAPI2GenerateClientMenu: StubMenu('OpenAPI2GenerateClient'),
  TopBarAggregateMenu: StubMenu('Aggregate'),
  TopBarGitHubMenu: StubMenu('GitHub'),
  TopBarAboutMenu: StubMenu('About'),
  ThemeToggle: StubMenu('ThemeToggle'),
};

const getComponent = (name) => stubComponents[name];

// Both the visible row/panel and the hidden measuring copy render each
// menu's label, so assertions on the *visible* one need to filter it out.
const isVisible = (text) =>
  screen.queryAllByText(text).some((el) => !el.closest('.swagger-editor__top-bar-measure'));

function makeItNotFit(container) {
  const topBar = container.querySelector('.swagger-editor__top-bar');
  const measure = container.querySelector('.swagger-editor__top-bar-measure');
  Object.defineProperty(topBar, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(measure, 'scrollWidth', { value: 900, configurable: true });
  act(() => {
    MockResizeObserver.instances[0].callback();
  });
}

describe('TopBar', () => {
  const originalResizeObserver = window.ResizeObserver;

  beforeEach(() => {
    MockResizeObserver.instances = [];
    window.ResizeObserver = MockResizeObserver;
  });

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver;
  });

  test('renders every menu inline with no hamburger button when the row fits', () => {
    render(<TopBar getComponent={getComponent} />);

    expect(screen.queryByRole('button', { name: /open menu/i })).not.toBeInTheDocument();
    expect(isVisible('File')).toBe(true);
    expect(isVisible('GitHub')).toBe(true);
  });

  test('collapses behind a hamburger button once the row no longer fits', () => {
    const { container } = render(<TopBar getComponent={getComponent} />);
    makeItNotFit(container);

    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
    expect(isVisible('File')).toBe(false);
  });

  test('tapping the hamburger reveals the menus, tapping again hides them', () => {
    const { container } = render(<TopBar getComponent={getComponent} />);
    makeItNotFit(container);

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(isVisible('File')).toBe(true);
    expect(isVisible('GitHub')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /close menu/i }));
    expect(isVisible('File')).toBe(false);
  });

  test('clicking outside the open menu closes it', () => {
    const { container } = render(
      <div>
        <TopBar getComponent={getComponent} />
        <button type="button">Outside</button>
      </div>
    );
    makeItNotFit(container);

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(isVisible('File')).toBe(true);

    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(isVisible('File')).toBe(false);
  });
});
