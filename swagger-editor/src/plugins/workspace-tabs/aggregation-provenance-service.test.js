import { describe, expect, test, beforeEach } from 'vitest';

import {
  getAggregationProvenance,
  removeAggregationProvenance,
  setAggregationProvenance,
} from './aggregation-provenance-service.js';

describe('aggregation-provenance-service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns null when no record is stored for the tab', () => {
    expect(getAggregationProvenance('a')).toBeNull();
  });

  test('round-trips a record independently per tab', () => {
    const recordA = {
      setName: 'My Set',
      sources: [
        {
          name: 'Users',
          url: 'https://github.com/owner/users/blob/main/openapi.yaml',
          apiBaseUrl: 'https://api.github.com',
          owner: 'owner',
          repo: 'users',
          path: 'openapi.yaml',
          ref: 'main',
          baselineContent: 'openapi: 3.0.0\n',
        },
      ],
      provenance: { paths: { '/users': { service: 'Users', originalKey: '/users' } } },
      baselineMergedText: 'openapi: 3.0.0\npaths:\n  /users: {}\n',
    };
    const recordB = { ...recordA, setName: 'Other Set' };

    setAggregationProvenance('a', recordA);
    setAggregationProvenance('b', recordB);

    expect(getAggregationProvenance('a')).toEqual(recordA);
    expect(getAggregationProvenance('b')).toEqual(recordB);
  });

  test('removeAggregationProvenance clears only that tab', () => {
    setAggregationProvenance('a', { setName: 'Set A' });
    setAggregationProvenance('b', { setName: 'Set B' });

    removeAggregationProvenance('a');

    expect(getAggregationProvenance('a')).toBeNull();
    expect(getAggregationProvenance('b')).toEqual({ setName: 'Set B' });
  });

  test('falls back to null when the stored value is corrupt JSON', () => {
    localStorage.setItem('workspace-tabs:aggregation-provenance:a', 'not json');

    expect(getAggregationProvenance('a')).toBeNull();
  });
});
