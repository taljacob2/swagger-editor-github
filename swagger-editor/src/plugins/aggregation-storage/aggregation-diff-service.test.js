import { diffAggregatedSpecs } from './aggregation-diff-service.js';

describe('diffAggregatedSpecs', () => {
  test('reports no changes for two identical snapshots', () => {
    const spec = { paths: { '/users': { get: { summary: 'List' } } } };

    expect(diffAggregatedSpecs(spec, spec)).toEqual({ resolved: [], unresolved: [] });
  });

  test('resolves a simple field edit on an existing path', () => {
    const baseline = { paths: { '/users': { get: { summary: 'List users' } } } };
    const current = { paths: { '/users': { get: { summary: 'List all users' } } } };

    const { resolved, unresolved } = diffAggregatedSpecs(baseline, current);

    expect(unresolved).toEqual([]);
    expect(resolved).toEqual([
      {
        entryType: 'paths',
        finalKey: '/users',
        subPath: ['get', 'summary'],
        oldValue: 'List users',
        newValue: 'List all users',
      },
    ]);
  });

  test('resolves a nested field edit several levels deep', () => {
    const baseline = {
      components: {
        schemas: { User: { properties: { status: { enum: ['active', 'inactive'] } } } },
      },
    };
    const current = {
      components: {
        schemas: { User: { properties: { status: { enum: ['active', 'inactive', 'banned'] } } } },
      },
    };

    const { resolved } = diffAggregatedSpecs(baseline, current);

    expect(resolved).toEqual([
      {
        entryType: 'schemas',
        finalKey: 'User',
        subPath: ['properties', 'status', 'enum'],
        oldValue: ['active', 'inactive'],
        newValue: ['active', 'inactive', 'banned'],
      },
    ]);
  });

  test('replaces a changed array as a single leaf rather than diffing its elements', () => {
    const baseline = { paths: { '/users': { get: { parameters: [{ name: 'limit' }] } } } };
    const current = {
      paths: { '/users': { get: { parameters: [{ name: 'limit' }, { name: 'offset' }] } } },
    };

    const { resolved } = diffAggregatedSpecs(baseline, current);

    expect(resolved).toEqual([
      {
        entryType: 'paths',
        finalKey: '/users',
        subPath: ['get', 'parameters'],
        oldValue: [{ name: 'limit' }],
        newValue: [{ name: 'limit' }, { name: 'offset' }],
      },
    ]);
  });

  test('flags a whole-entry addition as unresolved, not a field edit', () => {
    const baseline = { paths: { '/users': {} } };
    const current = { paths: { '/users': {}, '/orders': {} } };

    const { resolved, unresolved } = diffAggregatedSpecs(baseline, current);

    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([
      { entryType: 'paths', finalKey: '/orders', reason: 'entry-added' },
    ]);
  });

  test('flags a whole-entry removal as unresolved, not a field edit', () => {
    const baseline = { paths: { '/users': {}, '/orders': {} } };
    const current = { paths: { '/users': {} } };

    const { resolved, unresolved } = diffAggregatedSpecs(baseline, current);

    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([
      { entryType: 'paths', finalKey: '/orders', reason: 'entry-removed' },
    ]);
  });

  test('resolves adding and removing a field within an existing entry', () => {
    const baseline = { tags: [{ name: 'Users', description: 'User operations' }] };
    const current = { tags: [{ name: 'Users', externalDocs: { url: 'https://example.com' } }] };

    const { resolved } = diffAggregatedSpecs(baseline, current);

    expect(resolved).toEqual(
      expect.arrayContaining([
        {
          entryType: 'tags',
          finalKey: 'Users',
          subPath: ['description'],
          oldValue: 'User operations',
          newValue: undefined,
        },
        {
          entryType: 'tags',
          finalKey: 'Users',
          subPath: ['externalDocs'],
          oldValue: undefined,
          newValue: { url: 'https://example.com' },
        },
      ])
    );
    expect(resolved).toHaveLength(2);
  });

  test('walks every component sub-collection, not just schemas', () => {
    const baseline = { components: { parameters: { Limit: { schema: { type: 'integer' } } } } };
    const current = { components: { parameters: { Limit: { schema: { type: 'number' } } } } };

    const { resolved } = diffAggregatedSpecs(baseline, current);

    expect(resolved).toEqual([
      {
        entryType: 'parameters',
        finalKey: 'Limit',
        subPath: ['schema', 'type'],
        oldValue: 'integer',
        newValue: 'number',
      },
    ]);
  });

  test('ignores an entry untouched by either snapshot', () => {
    const baseline = { paths: { '/a': { get: {} }, '/b': { get: {} } } };
    const current = { paths: { '/a': { get: { summary: 'changed' } }, '/b': { get: {} } } };

    const { resolved, unresolved } = diffAggregatedSpecs(baseline, current);

    expect(unresolved).toEqual([]);
    expect(resolved).toEqual([
      {
        entryType: 'paths',
        finalKey: '/a',
        subPath: ['get', 'summary'],
        oldValue: undefined,
        newValue: 'changed',
      },
    ]);
  });

  test('handles specs with no paths/tags/components at all', () => {
    expect(diffAggregatedSpecs({}, {})).toEqual({ resolved: [], unresolved: [] });
  });
});
