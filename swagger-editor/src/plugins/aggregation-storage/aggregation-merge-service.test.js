import YAML from 'js-yaml';

import { aggregateSet, fetchSpec, mergeSpecs } from './aggregation-merge-service.js';

const CONNECTION = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };

describe('fetchSpec', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => 'openapi: 3.0.0\ninfo:\n  title: X\n  version: "1.0.0"\n',
    }));
  });

  test('parses YAML text into an object', async () => {
    const spec = await fetchSpec('https://api.github.com/repos/x/y/contents/z', CONNECTION);
    expect(spec).toEqual({ openapi: '3.0.0', info: { title: 'X', version: '1.0.0' } });
  });

  test('attaches the token when the URL host matches the configured API host', async () => {
    await fetchSpec('https://api.github.com/repos/x/y/contents/z', CONNECTION);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/x/y/contents/z',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
    );
  });

  test('attaches the token to raw.githubusercontent.com', async () => {
    await fetchSpec('https://raw.githubusercontent.com/owner/repo/main/openapi.yaml', CONNECTION);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
    );
  });

  test('does NOT attach the token to an unrelated third-party URL', async () => {
    await fetchSpec('https://example.com/openapi.yaml', CONNECTION);
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/openapi.yaml', { headers: {} });
  });

  test('throws with the status on a non-OK response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(fetchSpec('https://example.com/openapi.yaml', CONNECTION)).rejects.toThrow('404');
  });
});

describe('mergeSpecs', () => {
  test('returns null for an empty list', () => {
    expect(mergeSpecs([])).toBeNull();
  });

  test('passes a single spec through unchanged', () => {
    const spec = { openapi: '3.0.0', paths: { '/x': {} } };
    expect(mergeSpecs([{ name: 'Only', spec }])).toEqual({
      merged: spec,
      conflicts: { paths: [], tags: [], components: [] },
    });
  });

  test('merges non-colliding paths/tags/schemas from two specs with no prefixing', () => {
    const users = {
      name: 'Users',
      spec: {
        paths: { '/users': { get: { tags: ['Users'] } } },
        tags: [{ name: 'Users' }],
        components: { schemas: { User: { type: 'object' } } },
      },
    };
    const orders = {
      name: 'Orders',
      spec: {
        paths: { '/orders': { get: { tags: ['Orders'] } } },
        tags: [{ name: 'Orders' }],
        components: { schemas: { Order: { type: 'object' } } },
      },
    };

    const { merged, conflicts } = mergeSpecs([users, orders]);

    expect(Object.keys(merged.paths)).toEqual(['/users', '/orders']);
    expect(merged.paths['/users'].get.tags).toEqual(['Users']);
    expect(merged.components.schemas).toEqual({
      User: { type: 'object' },
      Order: { type: 'object' },
    });
    expect(conflicts).toEqual({ paths: [], tags: [], components: [] });
  });

  test('prefixes a colliding path with the service name, for every service that has it', () => {
    const a = { name: 'Users', spec: { paths: { '/profile': { get: {} } } } };
    const b = { name: 'Orders', spec: { paths: { '/profile': { get: {} } } } };

    const { merged, conflicts } = mergeSpecs([a, b]);

    expect(Object.keys(merged.paths).sort()).toEqual(['/orders/profile', '/users/profile']);
    expect(conflicts.paths).toEqual([{ path: '/profile', services: ['Users', 'Orders'] }]);
  });

  test('prefixes a colliding tag name and the operations referencing it', () => {
    const a = {
      name: 'Users',
      spec: { paths: { '/a': { get: { tags: ['Shared'] } } }, tags: [{ name: 'Shared' }] },
    };
    const b = {
      name: 'Orders',
      spec: { paths: { '/b': { get: { tags: ['Shared'] } } }, tags: [{ name: 'Shared' }] },
    };

    const { merged, conflicts } = mergeSpecs([a, b]);

    expect(merged.paths['/a'].get.tags).toEqual(['Users-Shared']);
    expect(merged.paths['/b'].get.tags).toEqual(['Orders-Shared']);
    expect(merged.tags.map((t) => t.name).sort()).toEqual(['Orders-Shared', 'Users-Shared']);
    expect(conflicts.tags).toEqual([{ tagName: 'Shared', services: ['Users', 'Orders'] }]);
  });

  test('prefixes a colliding schema name in both services', () => {
    const a = { name: 'Users', spec: { components: { schemas: { Entity: { type: 'object' } } } } };
    const b = { name: 'Orders', spec: { components: { schemas: { Entity: { type: 'string' } } } } };

    const { merged, conflicts } = mergeSpecs([a, b]);

    expect(merged.components.schemas).toEqual({
      UsersEntity: { type: 'object' },
      OrdersEntity: { type: 'string' },
    });
    expect(conflicts.components).toEqual([
      { type: 'schemas', name: 'Entity', services: ['Users', 'Orders'] },
    ]);
  });

  test('a name shared across different component types does not falsely conflict', () => {
    // "Entity" as a schema in one service and as a parameter in another --
    // these are different buckets and must not be treated as colliding.
    const a = { name: 'Users', spec: { components: { schemas: { Entity: { type: 'object' } } } } };
    const b = { name: 'Orders', spec: { components: { parameters: { Entity: { name: 'id' } } } } };

    const { merged, conflicts } = mergeSpecs([a, b]);

    expect(merged.components.schemas).toEqual({ Entity: { type: 'object' } });
    expect(merged.components.parameters).toEqual({ Entity: { name: 'id' } });
    expect(conflicts.components).toEqual([]);
  });

  test('deduplicates identical servers and security entries', () => {
    const shared = { url: 'https://example.com' };
    const a = { name: 'Users', spec: { servers: [shared], security: [{ apiKey: [] }] } };
    const b = { name: 'Orders', spec: { servers: [shared], security: [{ apiKey: [] }] } };

    const { merged } = mergeSpecs([a, b]);

    expect(merged.servers).toEqual([shared]);
    expect(merged.security).toEqual([{ apiKey: [] }]);
  });

  test('auto-generates an info.description listing the merged services', () => {
    const a = { name: 'Users', spec: {} };
    const b = { name: 'Orders', spec: {} };

    const { merged } = mergeSpecs([a, b]);

    expect(merged.info.description).toBe('Aggregated API from 2 microservices: Users, Orders');
    expect(merged.info.title).toBe('Aggregated API');
  });

  test('honors an info title override and omits empty sections entirely', () => {
    const a = { name: 'Users', spec: {} };
    const b = { name: 'Orders', spec: {} };

    const { merged } = mergeSpecs([a, b], { title: 'My Combined Set' });

    expect(merged.info.title).toBe('My Combined Set');
    expect(merged).not.toHaveProperty('servers');
    expect(merged).not.toHaveProperty('tags');
    expect(merged).not.toHaveProperty('security');
    expect(merged).not.toHaveProperty('paths');
    expect(merged).not.toHaveProperty('components');
  });
});

describe('aggregateSet', () => {
  const setOf = (urls) => ({ name: 'My Set', swaggerUrls: urls });

  test('fetches and merges every URL in the set', async () => {
    global.fetch = vi.fn(async (url) => ({
      ok: true,
      text: async () =>
        url.includes('users') ? 'paths:\n  /users: {}\n' : 'paths:\n  /orders: {}\n',
    }));

    const result = await aggregateSet(
      setOf([
        { name: 'Users', url: 'https://example.com/users.yaml' },
        { name: 'Orders', url: 'https://example.com/orders.yaml' },
      ]),
      CONNECTION
    );

    expect(result.specCount).toBe(2);
    expect(result.errors).toEqual([]);
    const parsed = YAML.load(result.yaml);
    expect(Object.keys(parsed.paths).sort()).toEqual(['/orders', '/users']);
  });

  test('continues past a partial failure and reports it', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes('broken')) {
        return { ok: false, status: 500, statusText: 'Server Error' };
      }
      return { ok: true, text: async () => 'paths:\n  /users: {}\n' };
    });

    const result = await aggregateSet(
      setOf([
        { name: 'Users', url: 'https://example.com/users.yaml' },
        { name: 'Broken', url: 'https://example.com/broken.yaml' },
      ]),
      CONNECTION
    );

    expect(result.specCount).toBe(1);
    expect(result.errors).toEqual([{ name: 'Broken', message: 'HTTP 500: Server Error' }]);
  });

  test('throws when every URL fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));

    await expect(
      aggregateSet(setOf([{ name: 'Users', url: 'https://example.com/users.yaml' }]), CONNECTION)
    ).rejects.toThrow('No specs could be fetched');
  });
});
