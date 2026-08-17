import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import TopBar from './TopBar.jsx';
import useIsMobile from '../../../layout/hooks/useIsMobile.js';

vi.mock('../../../layout/hooks/useIsMobile.js', () => ({ default: vi.fn() }));

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
};

const getComponent = (name) => stubComponents[name];

describe('TopBar', () => {
  test('desktop: renders every menu inline with no hamburger button', () => {
    useIsMobile.mockReturnValue(false);
    render(<TopBar getComponent={getComponent} />);

    expect(screen.queryByRole('button', { name: /open menu/i })).not.toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  test('mobile: menus start collapsed behind a hamburger button', () => {
    useIsMobile.mockReturnValue(true);
    render(<TopBar getComponent={getComponent} />);

    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
    expect(screen.queryByText('File')).not.toBeInTheDocument();
  });

  test('mobile: tapping the hamburger reveals the menus, tapping again hides them', () => {
    useIsMobile.mockReturnValue(true);
    render(<TopBar getComponent={getComponent} />);

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close menu/i }));
    expect(screen.queryByText('File')).not.toBeInTheDocument();
  });

  test('mobile: clicking outside the open menu closes it', () => {
    useIsMobile.mockReturnValue(true);
    render(
      <div>
        <TopBar getComponent={getComponent} />
        <button type="button">Outside</button>
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByText('File')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(screen.queryByText('File')).not.toBeInTheDocument();
  });
});
