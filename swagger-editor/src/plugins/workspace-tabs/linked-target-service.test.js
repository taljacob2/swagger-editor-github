import { describe, expect, test, beforeEach } from 'vitest';

import { getLinkedTarget, removeLinkedTarget, setLinkedTarget } from './linked-target-service.js';

describe('linked-target-service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns null when no link is stored for the tab', () => {
    expect(getLinkedTarget('a')).toBeNull();
  });

  test('round-trips a linked target independently per tab', () => {
    const targetA = {
      apiBaseUrl: 'https://api.github.com',
      owner: 'owner',
      repo: 'repo-a',
      path: 'openapi.yaml',
      ref: 'main',
      baselineContent: 'openapi: 3.0.0\n',
      baselineFetchedAt: '2026-08-28T00:00:00.000Z',
    };
    const targetB = { ...targetA, repo: 'repo-b' };

    setLinkedTarget('a', targetA);
    setLinkedTarget('b', targetB);

    expect(getLinkedTarget('a')).toEqual(targetA);
    expect(getLinkedTarget('b')).toEqual(targetB);
  });

  test('removeLinkedTarget clears only that tab', () => {
    setLinkedTarget('a', { owner: 'owner', repo: 'repo-a' });
    setLinkedTarget('b', { owner: 'owner', repo: 'repo-b' });

    removeLinkedTarget('a');

    expect(getLinkedTarget('a')).toBeNull();
    expect(getLinkedTarget('b')).toEqual({ owner: 'owner', repo: 'repo-b' });
  });

  test('falls back to null when the stored value is corrupt JSON', () => {
    localStorage.setItem('workspace-tabs:link:a', 'not json');

    expect(getLinkedTarget('a')).toBeNull();
  });
});
