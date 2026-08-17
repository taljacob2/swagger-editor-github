import React from 'react';
import { act, render, screen } from '@testing-library/react';

import useOverflowCompact from './useOverflowCompact.js';

class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    MockResizeObserver.instances.push(this);
  }

  observe(el) {
    this.observed.push(el);
  }

  // eslint-disable-next-line class-methods-use-this
  disconnect() {}
}
MockResizeObserver.instances = [];

const TestHarness = () => {
  const { containerRef, measureRef, isCompact } = useOverflowCompact();
  return (
    <div ref={containerRef} data-testid="container">
      <div ref={measureRef} data-testid="measure" />
      <span>{isCompact ? 'compact' : 'full'}</span>
    </div>
  );
};

describe('useOverflowCompact', () => {
  const originalResizeObserver = window.ResizeObserver;

  beforeEach(() => {
    MockResizeObserver.instances = [];
    window.ResizeObserver = MockResizeObserver;
  });

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver;
  });

  test('starts as "full" when the measured content is no wider than the container', () => {
    render(<TestHarness />);
    expect(screen.getByText('full')).toBeInTheDocument();
  });

  test('flips to "compact" once the measured content no longer fits', () => {
    render(<TestHarness />);
    const container = screen.getByTestId('container');
    const measure = screen.getByTestId('measure');

    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(measure, 'scrollWidth', { value: 500, configurable: true });

    act(() => {
      MockResizeObserver.instances[0].callback();
    });

    expect(screen.getByText('compact')).toBeInTheDocument();
  });

  test('flips back to "full" once there is room again', () => {
    render(<TestHarness />);
    const container = screen.getByTestId('container');
    const measure = screen.getByTestId('measure');

    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(measure, 'scrollWidth', { value: 500, configurable: true });
    act(() => {
      MockResizeObserver.instances[0].callback();
    });
    expect(screen.getByText('compact')).toBeInTheDocument();

    Object.defineProperty(container, 'clientWidth', { value: 900, configurable: true });
    act(() => {
      MockResizeObserver.instances[0].callback();
    });

    expect(screen.getByText('full')).toBeInTheDocument();
  });

  test('observes both the container and the measured content', () => {
    render(<TestHarness />);
    const container = screen.getByTestId('container');
    const measure = screen.getByTestId('measure');

    // The container can stay the same size while the measured content
    // changes width on its own (e.g. a web font finishing its async load) --
    // missing that would leave isCompact stuck on a stale reading.
    expect(MockResizeObserver.instances[0].observed).toEqual([container, measure]);
  });

  test('flips to "compact" when only the measured content changes, container untouched', () => {
    render(<TestHarness />);
    const measure = screen.getByTestId('measure');

    Object.defineProperty(measure, 'scrollWidth', { value: 5000, configurable: true });
    act(() => {
      MockResizeObserver.instances[0].callback();
    });

    expect(screen.getByText('compact')).toBeInTheDocument();
  });
});
