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

  // raw.githubusercontent.com rejects any cross-origin fetch carrying an
  // Authorization header at the CORS preflight stage -- confirmed against
  // the real service, not just a config assumption -- so raw/blob URLs are
  // rewritten to the Contents API instead, which does support it.
  describe('GitHub raw/blob URL rewriting', () => {
    const contentsFetch = (base64Content) =>
      vi.fn(async () => ({ ok: true, json: async () => ({ content: base64Content }) }));

    test('rewrites a raw.githubusercontent.com URL to the Contents API and decodes the result', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));

      const spec = await fetchSpec(
        'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
        CONNECTION
      );

      expect(spec).toEqual({ openapi: '3.0.0' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer test-token',
          },
        }
      );
    });

    test('rewrites a github.com blob URL the same way, including nested paths', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));

      await fetchSpec(
        'https://github.com/owner/repo/blob/main/specs/nested/openapi.yaml',
        CONNECTION
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/specs/nested/openapi.yaml?ref=main',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: expect.any(String) }),
        })
      );
    });

    test('a plain github.com URL does not attach a GHEC-configured token (wrong instance)', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com', token: 'test-token' };

      await fetchSpec(
        'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
        ghecConnection
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        { headers: { Accept: 'application/vnd.github+json' } }
      );
    });

    // GHEC/GHE.com blob and raw hosts are derived from the user's own
    // configured apiBaseUrl (api.mycompany.ghe.com -> mycompany.ghe.com),
    // not hardcoded -- unverified against a real org, but this is the
    // best-effort generalization of github.com's own host-splitting pattern.
    test('rewrites a GHEC blob URL to that instance’s own Contents API, with its own token', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com', token: 'ghec-token' };

      await fetchSpec(
        'https://mycompany.ghe.com/owner/repo/blob/main/openapi.yaml',
        ghecConnection
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mycompany.ghe.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer ghec-token',
          },
        }
      );
    });

    test('rewrites a guessed GHEC raw-content URL (raw.<domain>) the same way', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com', token: 'ghec-token' };

      await fetchSpec('https://raw.mycompany.ghe.com/owner/repo/main/openapi.yaml', ghecConnection);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mycompany.ghe.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghec-token' }),
        })
      );
    });

    test('strips a trailing slash from a configured apiBaseUrl before building the Contents API URL', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com/', token: 'ghec-token' };

      await fetchSpec(
        'https://mycompany.ghe.com/owner/repo/blob/main/openapi.yaml',
        ghecConnection
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mycompany.ghe.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        expect.anything()
      );
    });

    // Copying GitHub's own "view raw" link on a private file (e.g. from
    // browsing raw.<domain> in a browser tab) carries a short-lived
    // `?token=...` query parameter -- GitHub's own signed-URL mechanism,
    // unrelated to a PAT. That token isn't needed (or usable) here: this
    // rewrite always authenticates via the user's own persistent PAT
    // through the Contents API instead, so the pasted URL should work
    // exactly the same whether or not it carries one.
    test('rewrites a raw URL that carries GitHub’s own "?token=" query string, ignoring it', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com', token: 'ghec-token' };

      await fetchSpec(
        'https://raw.mycompany.ghe.com/owner/repo/main/openapi.yaml?token=GHSAT0AAAAAA',
        ghecConnection
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mycompany.ghe.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghec-token' }),
        })
      );
    });

    // GitHub's own "copy raw link"/"view raw" now generates URLs using this
    // explicit `refs/heads/<branch>` (or `refs/tags/<tag>`) form by default,
    // not the older bare `<branch>/<path>` shape. Before this was handled,
    // "refs" itself was captured as the ref and "heads/<branch>/<path>" was
    // captured as the path, producing a malformed, 404ing Contents API
    // request (confirmed against a live deployment).
    test('rewrites a raw URL using the explicit refs/heads/<branch> form', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));

      await fetchSpec(
        'https://raw.githubusercontent.com/owner/repo/refs/heads/migrate-swagger-to-graphql/openapi.yaml',
        CONNECTION
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=migrate-swagger-to-graphql',
        expect.anything()
      );
    });

    test('rewrites a blob URL using the explicit refs/tags/<tag> form', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));

      await fetchSpec(
        'https://github.com/owner/repo/blob/refs/tags/v1.2.3/specs/openapi.yaml',
        CONNECTION
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/specs/openapi.yaml?ref=v1.2.3',
        expect.anything()
      );
    });

    test('rewrites a GHEC raw URL using the explicit refs/heads/<branch> form', async () => {
      global.fetch = contentsFetch(btoa('openapi: 3.0.0\n'));
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com', token: 'ghec-token' };

      await fetchSpec(
        'https://raw.mycompany.ghe.com/owner/repo/refs/heads/migrate-swagger-to-graphql/openapi.yaml',
        ghecConnection
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mycompany.ghe.com/repos/owner/repo/contents/openapi.yaml?ref=migrate-swagger-to-graphql',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghec-token' }),
        })
      );
    });

    test('does not treat an unrelated third-party host as a GitHub file URL just because it has a similar shape', async () => {
      // Unparsed fallback path reads response.text(), not .json() -- reuse
      // the plain text-based mock from the outer beforeEach, not contentsFetch.
      const ghecConnection = { apiBaseUrl: 'https://api.mycompany.ghe.com', token: 'ghec-token' };

      await fetchSpec('https://evil.example.com/owner/repo/blob/main/openapi.yaml', ghecConnection);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://evil.example.com/owner/repo/blob/main/openapi.yaml',
        { headers: {} }
      );
    });
  });

  test('does NOT attach the token to an unrelated third-party URL', async () => {
    await fetchSpec('https://example.com/openapi.yaml', CONNECTION);
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/openapi.yaml', { headers: {} });
  });

  test('prefers a dedicated fetchToken over the main token when both are set', async () => {
    const connection = { ...CONNECTION, fetchToken: 'read-only-fetch-token' };
    await fetchSpec('https://api.github.com/repos/x/y/contents/z', connection);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/x/y/contents/z',
      expect.objectContaining({ headers: { Authorization: 'Bearer read-only-fetch-token' } })
    );
  });

  test('falls back to the main token when fetchToken is not set', async () => {
    const connection = { ...CONNECTION, fetchToken: '' };
    await fetchSpec('https://api.github.com/repos/x/y/contents/z', connection);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/x/y/contents/z',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
    );
  });

  test('throws with the status on a non-OK response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
    });
    await expect(fetchSpec('https://example.com/openapi.yaml', CONNECTION)).rejects.toThrow('404');
  });

  test('attaches the SSO authorization url on a 403 blocked by org SSO enforcement', async () => {
    const ssoUrl = 'https://github.com/orgs/octo-org/sso?authorization_request=abc123';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: (name) => (name === 'X-GitHub-SSO' ? `required; url=${ssoUrl}` : null) },
    });

    await expect(
      fetchSpec('https://api.github.com/repos/x/y/contents/z', CONNECTION)
    ).rejects.toMatchObject({ ssoUrl });
  });

  // A raw/blob URL whose host doesn't match connection.apiBaseUrl never gets
  // rewritten to the Contents API (see github-file-url.js), so the browser
  // fetches it as-is and CORS blocks it -- a network-level failure with no
  // response to inspect, not a normal HTTP error.
  describe('when a raw/blob-shaped URL is not routed through the Contents API', () => {
    test('explains the likely cause instead of surfacing the raw CORS error', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expect(
        fetchSpec(
          'https://raw.mycompany.ghe.com/owner/repo/refs/heads/main/openapi.yaml',
          CONNECTION
        )
      ).rejects.toThrow('API base URL');
    });

    test('does the same for a /blob/ URL', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expect(
        fetchSpec('https://mycompany.ghe.com/owner/repo/blob/main/openapi.yaml', CONNECTION)
      ).rejects.toThrow('API base URL');
    });

    test('leaves an unrelated URL failure as-is', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expect(fetchSpec('https://example.com/openapi.yaml', CONNECTION)).rejects.toThrow(
        'Failed to fetch'
      );
    });
  });
});

describe('mergeSpecs', () => {
  test('returns null for an empty list', () => {
    expect(mergeSpecs([])).toBeNull();
  });

  test('throws when two services share the same name instead of baking an ambiguous provenance map', () => {
    const users = { name: 'Same', spec: { paths: { '/users': {} } } };
    const orders = {
      name: 'Same',
      spec: { components: { schemas: { Order: { type: 'object' } } } },
    };
    expect(() => mergeSpecs([users, orders])).toThrow(/"Same" is used by more than one service/);
  });

  test('passes a single spec through unchanged', () => {
    const spec = { openapi: '3.0.0', paths: { '/x': {} } };
    expect(mergeSpecs([{ name: 'Only', spec }])).toEqual({
      merged: spec,
      conflicts: { paths: [], tags: [], components: [] },
      provenance: {
        paths: { '/x': { service: 'Only', originalKey: '/x' } },
        tags: {},
        components: {},
      },
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
    expect(conflicts.paths).toEqual([
      {
        path: '/profile',
        services: ['Users', 'Orders'],
        renamed: [
          { service: 'Users', to: '/users/profile' },
          { service: 'Orders', to: '/orders/profile' },
        ],
      },
    ]);
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
    expect(conflicts.tags).toEqual([
      {
        tagName: 'Shared',
        services: ['Users', 'Orders'],
        renamed: [
          { service: 'Users', to: 'Users-Shared' },
          { service: 'Orders', to: 'Orders-Shared' },
        ],
      },
    ]);
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
      {
        type: 'schemas',
        name: 'Entity',
        services: ['Users', 'Orders'],
        renamed: [
          { service: 'Users', to: 'UsersEntity' },
          { service: 'Orders', to: 'OrdersEntity' },
        ],
      },
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

  test('drops a path literally named "__proto__" instead of polluting the merged object', () => {
    // A plain `{ __proto__: ... }` object-literal key sets the prototype at
    // parse time rather than creating an own property (Annex B.3.1) -- using
    // JSON.parse instead reproduces how a real fetched/parsed spec actually
    // carries an own enumerable "__proto__" key, which is what Object.keys/
    // Object.entries (and thus the vulnerable code path) would see.
    const evilSpec = JSON.parse('{"paths": {"__proto__": {"get": {}}, "/safe": {"get": {}}}}');
    const a = { name: 'Evil', spec: evilSpec };

    const { merged } = mergeSpecs([a, { name: 'Other', spec: { paths: { '/other': {} } } }]);

    expect(Object.getPrototypeOf(merged.paths)).toBe(Object.prototype);
    expect(Object.keys(merged.paths).sort()).toEqual(['/other', '/safe']);
  });

  test('drops a component literally named "constructor"/"prototype" instead of shadowing them', () => {
    const a = {
      name: 'Evil',
      spec: {
        components: {
          schemas: { constructor: { type: 'object' }, prototype: { type: 'object' }, Ok: {} },
        },
      },
    };

    const { merged, conflicts } = mergeSpecs([
      a,
      { name: 'Other', spec: { components: { schemas: { Other: {} } } } },
    ]);

    expect(Object.getPrototypeOf(merged.components.schemas)).toBe(Object.prototype);
    expect(Object.keys(merged.components.schemas).sort()).toEqual(['Ok', 'Other']);
    expect(conflicts.components).toEqual([]);
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

  describe('provenance', () => {
    test('traces a non-colliding entry back to its owning service under its own name', () => {
      const users = {
        name: 'Users',
        spec: {
          paths: { '/users': {} },
          tags: [{ name: 'Users' }],
          components: { schemas: { User: { type: 'object' } } },
        },
      };
      const orders = { name: 'Orders', spec: { paths: { '/orders': {} } } };

      const { provenance } = mergeSpecs([users, orders]);

      expect(provenance.paths['/users']).toEqual({ service: 'Users', originalKey: '/users' });
      expect(provenance.paths['/orders']).toEqual({ service: 'Orders', originalKey: '/orders' });
      expect(provenance.tags.Users).toEqual({ service: 'Users', originalKey: 'Users' });
      expect(provenance.components.schemas.User).toEqual({
        service: 'Users',
        originalKey: 'User',
      });
    });

    test('traces a colliding entry back to its source under its renamed (final) key', () => {
      const a = { name: 'Users', spec: { paths: { '/profile': {} } } };
      const b = { name: 'Orders', spec: { paths: { '/profile': {} } } };

      const { provenance } = mergeSpecs([a, b]);

      expect(provenance.paths['/users/profile']).toEqual({
        service: 'Users',
        originalKey: '/profile',
      });
      expect(provenance.paths['/orders/profile']).toEqual({
        service: 'Orders',
        originalKey: '/profile',
      });
      expect(provenance.paths).not.toHaveProperty('/profile');
    });

    test('traces a colliding tag and component the same way', () => {
      const a = {
        name: 'Users',
        spec: {
          tags: [{ name: 'Shared' }],
          components: { schemas: { Entity: { type: 'object' } } },
        },
      };
      const b = {
        name: 'Orders',
        spec: {
          tags: [{ name: 'Shared' }],
          components: { schemas: { Entity: { type: 'string' } } },
        },
      };

      const { provenance } = mergeSpecs([a, b]);

      expect(provenance.tags['Users-Shared']).toEqual({ service: 'Users', originalKey: 'Shared' });
      expect(provenance.tags['Orders-Shared']).toEqual({
        service: 'Orders',
        originalKey: 'Shared',
      });
      expect(provenance.components.schemas.UsersEntity).toEqual({
        service: 'Users',
        originalKey: 'Entity',
      });
      expect(provenance.components.schemas.OrdersEntity).toEqual({
        service: 'Orders',
        originalKey: 'Entity',
      });
    });

    test('does not trace a path name rejected as an unsafe object key', () => {
      // See the "drops a path literally named __proto__" test above for why
      // this needs JSON.parse rather than an object literal.
      const evilSpec = JSON.parse('{"paths": {"__proto__": {"get": {}}, "/real": {"get": {}}}}');
      const a = { name: 'Users', spec: evilSpec };

      const { provenance } = mergeSpecs([a, { name: 'Orders', spec: { paths: { '/other': {} } } }]);

      expect(Object.keys(provenance.paths).sort()).toEqual(['/other', '/real']);
    });
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

  test('reports each successful source alongside the raw text it fetched', async () => {
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

    expect(result.sources).toEqual([
      {
        name: 'Users',
        url: 'https://example.com/users.yaml',
        rawContent: 'paths:\n  /users: {}\n',
      },
      {
        name: 'Orders',
        url: 'https://example.com/orders.yaml',
        rawContent: 'paths:\n  /orders: {}\n',
      },
    ]);
  });

  test('omits a failed URL from sources', async () => {
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

    expect(result.sources).toEqual([
      {
        name: 'Users',
        url: 'https://example.com/users.yaml',
        rawContent: 'paths:\n  /users: {}\n',
      },
    ]);
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
    expect(result.errors).toEqual([
      { name: 'Broken', message: 'HTTP 500: Server Error', ssoUrl: null },
    ]);
  });

  test('throws when every URL fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));

    await expect(
      aggregateSet(setOf([{ name: 'Users', url: 'https://example.com/users.yaml' }]), CONNECTION)
    ).rejects.toThrow('No specs could be fetched');
  });
});
