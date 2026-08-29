import {
  buildSourcePatchOps,
  groupResolvedOpsBySource,
  resolveSourceSubPath,
} from './aggregated-pr-planning-service.js';

const RECORD = {
  setName: 'My Set',
  sources: [
    {
      name: 'Users',
      url: 'https://github.com/octo-org/users/blob/main/openapi.yaml',
      apiBaseUrl: 'https://api.github.com',
      owner: 'octo-org',
      repo: 'users',
      path: 'openapi.yaml',
      ref: 'main',
      baselineContent: 'openapi: 3.0.0\n',
    },
    {
      name: 'Orders',
      url: 'https://not-a-github-url.example.com/orders.yaml',
      apiBaseUrl: 'https://api.github.com',
      owner: null,
      repo: null,
      path: null,
      ref: null,
      baselineContent: 'openapi: 3.0.0\n',
    },
  ],
  provenance: {
    paths: { '/users': { service: 'Users', originalKey: '/users' } },
    tags: { Users: { service: 'Users', originalKey: 'Users' } },
    components: {
      schemas: { User: { service: 'Users', originalKey: 'User' } },
    },
  },
  baselineMergedText: 'openapi: 3.0.0\n',
};

describe('groupResolvedOpsBySource', () => {
  test('groups an op under the source its provenance entry points to', () => {
    const resolved = [
      { entryType: 'paths', finalKey: '/users', subPath: ['get', 'summary'], newValue: 'X' },
    ];

    const { bySource, unresolved } = groupResolvedOpsBySource(RECORD, resolved);

    expect(unresolved).toEqual([]);
    expect(bySource.get('Users')).toEqual([
      {
        entryType: 'paths',
        finalKey: '/users',
        subPath: ['get', 'summary'],
        newValue: 'X',
        originalKey: '/users',
      },
    ]);
  });

  test('groups multiple ops for the same source together', () => {
    const resolved = [
      { entryType: 'paths', finalKey: '/users', subPath: ['get', 'summary'], newValue: 'X' },
      { entryType: 'tags', finalKey: 'Users', subPath: ['description'], newValue: 'Y' },
    ];

    const { bySource } = groupResolvedOpsBySource(RECORD, resolved);

    expect(bySource.get('Users')).toHaveLength(2);
  });

  test('flags an op with no matching provenance entry as unresolved', () => {
    const resolved = [{ entryType: 'paths', finalKey: '/unknown', subPath: [], newValue: 'X' }];

    const { bySource, unresolved } = groupResolvedOpsBySource(RECORD, resolved);

    expect(bySource.size).toBe(0);
    expect(unresolved).toEqual([
      { entryType: 'paths', finalKey: '/unknown', reason: 'no-provenance' },
    ]);
  });

  test('flags an op whose source could not be linked to a repo file as unresolved', () => {
    const record = {
      ...RECORD,
      provenance: {
        ...RECORD.provenance,
        paths: { '/orders': { service: 'Orders', originalKey: '/orders' } },
      },
    };
    const resolved = [{ entryType: 'paths', finalKey: '/orders', subPath: [], newValue: 'X' }];

    const { bySource, unresolved } = groupResolvedOpsBySource(record, resolved);

    expect(bySource.size).toBe(0);
    expect(unresolved).toEqual([
      { entryType: 'paths', finalKey: '/orders', reason: 'source-not-linked' },
    ]);
  });

  test('flags an op as unresolved instead of silently picking the wrong source when two sources share a name', () => {
    // Reproduces a stale AggregationProvenance record from before mergeSpecs
    // rejected name collisions: both sources are named "Same", and an entry
    // that really belongs to the second source (its provenance says so) must
    // not be attributed to the first just because a plain find() would land
    // there.
    const record = {
      ...RECORD,
      sources: [
        { ...RECORD.sources[0], name: 'Same' },
        { ...RECORD.sources[0], name: 'Same', path: 'other.yaml' },
      ],
      provenance: {
        ...RECORD.provenance,
        components: { schemas: { Order: { service: 'Same', originalKey: 'Order' } } },
      },
    };
    const resolved = [
      { entryType: 'schemas', finalKey: 'Order', subPath: ['properties', 'id'], newValue: 2 },
    ];

    const { bySource, unresolved } = groupResolvedOpsBySource(record, resolved);

    expect(bySource.size).toBe(0);
    expect(unresolved).toEqual([
      { entryType: 'schemas', finalKey: 'Order', reason: 'source-name-ambiguous' },
    ]);
  });
});

describe('resolveSourceSubPath', () => {
  test('resolves a paths op directly by its original key', () => {
    const op = { entryType: 'paths', originalKey: '/users', subPath: ['get', 'summary'] };

    expect(resolveSourceSubPath(op, {})).toEqual(['paths', '/users', 'get', 'summary']);
  });

  test('resolves a components op directly by type and original key', () => {
    const op = { entryType: 'schemas', originalKey: 'User', subPath: ['properties', 'name'] };

    expect(resolveSourceSubPath(op, {})).toEqual([
      'components',
      'schemas',
      'User',
      'properties',
      'name',
    ]);
  });

  test('resolves a tags op by searching for the tag by name in the source content', () => {
    const op = { entryType: 'tags', originalKey: 'Orders', subPath: ['description'] };
    const parsedSourceContent = { tags: [{ name: 'Users' }, { name: 'Orders' }] };

    expect(resolveSourceSubPath(op, parsedSourceContent)).toEqual(['tags', 1, 'description']);
  });

  test('returns null when the named tag is no longer present in the source', () => {
    const op = { entryType: 'tags', originalKey: 'Missing', subPath: ['description'] };
    const parsedSourceContent = { tags: [{ name: 'Users' }] };

    expect(resolveSourceSubPath(op, parsedSourceContent)).toBeNull();
  });

  test('returns null when the source has no tags at all', () => {
    const op = { entryType: 'tags', originalKey: 'Users', subPath: [] };

    expect(resolveSourceSubPath(op, {})).toBeNull();
  });
});

describe('buildSourcePatchOps', () => {
  test('builds a set op for a leaf value change', () => {
    const ops = [
      {
        entryType: 'paths',
        finalKey: '/users',
        originalKey: '/users',
        subPath: ['get', 'summary'],
        oldValue: 'Old',
        newValue: 'New',
      },
    ];

    const { patchOps, unresolved } = buildSourcePatchOps(ops, {});

    expect(unresolved).toEqual([]);
    expect(patchOps).toEqual([
      { subPath: ['paths', '/users', 'get', 'summary'], value: 'New', isDelete: false },
    ]);
  });

  test('marks an op as a delete when the new value is undefined', () => {
    const ops = [
      {
        entryType: 'paths',
        finalKey: '/users',
        originalKey: '/users',
        subPath: ['get', 'deprecated'],
        oldValue: true,
        newValue: undefined,
      },
    ];

    const { patchOps } = buildSourcePatchOps(ops, {});

    expect(patchOps).toEqual([
      { subPath: ['paths', '/users', 'get', 'deprecated'], value: undefined, isDelete: true },
    ]);
  });

  test('reports an op as unresolved when its subPath cannot be resolved', () => {
    const ops = [
      {
        entryType: 'tags',
        finalKey: 'Users',
        originalKey: 'Missing',
        subPath: ['description'],
        newValue: 'X',
      },
    ];

    const { patchOps, unresolved } = buildSourcePatchOps(ops, { tags: [{ name: 'Users' }] });

    expect(patchOps).toEqual([]);
    expect(unresolved).toEqual([
      { entryType: 'tags', finalKey: 'Users', reason: 'source-entry-missing' },
    ]);
  });
});
