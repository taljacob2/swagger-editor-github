import {
  BRANCH_PREFIX,
  DEFAULT_BRANCH,
  branchSuffixFromBranch,
  buildBranchName,
  canWriteToStorage,
  deleteAggregationSet,
  doesBranchExist,
  ensureDataBranch,
  getAggregationSet,
  getRepoDefaultBranch,
  getStorageSettings,
  getSwaggerUrlWarning,
  listAggregationSets,
  moveSwaggerUrl,
  saveAggregationSet,
  saveStorageSettings,
} from './aggregation-storage-service.js';

const CONNECTION = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };
const STORAGE = { owner: 'taljacob2', repo: 'swagger-editor-github', branch: DEFAULT_BRANCH };

const utf8ToBase64 = (text) => Buffer.from(text, 'utf8').toString('base64');

// A tiny router over global.fetch: each call is matched against `routes` in
// order, and matched calls are recorded on `calls` for assertions.
function mockFetch(routes) {
  const calls = [];
  global.fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({
      url,
      method,
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : undefined,
    });

    const route = routes.find((r) => r.method === method && r.test(url));
    if (!route) {
      throw new Error(`Unmocked request: ${method} ${url}`);
    }
    const status = route.status || 200;
    if (status >= 400) {
      return {
        ok: false,
        status,
        statusText: route.statusText || 'Error',
        text: async () => route.detail || '',
        headers: { get: (name) => (name === 'X-GitHub-SSO' ? route.ssoHeader || null : null) },
      };
    }
    return {
      ok: true,
      status,
      json: async () => route.json,
    };
  });
  return calls;
}

describe('aggregation-storage-service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('storage settings', () => {
    test('defaults to a github.io-derived owner/repo when hosted on Pages', () => {
      const originalLocation = window.location;
      delete window.location;
      window.location = { hostname: 'taljacob2.github.io', pathname: '/swagger-editor-github/' };

      expect(getStorageSettings()).toEqual({
        owner: 'taljacob2',
        repo: 'swagger-editor-github',
        branch: DEFAULT_BRANCH,
      });

      window.location = originalLocation;
    });

    test('defaults to an empty owner/repo when not hosted on github.io', () => {
      const originalLocation = window.location;
      delete window.location;
      window.location = { hostname: 'localhost', pathname: '/' };

      expect(getStorageSettings()).toEqual({ owner: '', repo: '', branch: DEFAULT_BRANCH });

      window.location = originalLocation;
    });

    // A privately published GHEC Pages site is served from a
    // <owner>-<repo>.pages.<hostname> subdomain, not <owner>.github.io/<repo>/
    // -- unparseable by hostname alone, since both owner and repo can contain
    // hyphens. deploy-pages.yml bakes the real values in at build time instead.
    test('defaults to the build-time VITE_GITHUB_STORAGE_OWNER/REPO when set', () => {
      const originalLocation = window.location;
      delete window.location;
      window.location = {
        hostname: 'octo-org-swagger-editor-github.pages.octo-ghec-host.ghe.com',
        pathname: '/',
      };
      vi.stubEnv('VITE_GITHUB_STORAGE_OWNER', 'octo-org');
      vi.stubEnv('VITE_GITHUB_STORAGE_REPO', 'swagger-editor-github');

      expect(getStorageSettings()).toEqual({
        owner: 'octo-org',
        repo: 'swagger-editor-github',
        branch: DEFAULT_BRANCH,
      });

      window.location = originalLocation;
    });

    test('prefers VITE_GITHUB_STORAGE_OWNER/REPO over github.io hostname parsing', () => {
      const originalLocation = window.location;
      delete window.location;
      window.location = { hostname: 'taljacob2.github.io', pathname: '/swagger-editor-github/' };
      vi.stubEnv('VITE_GITHUB_STORAGE_OWNER', 'acme');
      vi.stubEnv('VITE_GITHUB_STORAGE_REPO', 'specs');

      expect(getStorageSettings()).toEqual({
        owner: 'acme',
        repo: 'specs',
        branch: DEFAULT_BRANCH,
      });

      window.location = originalLocation;
    });

    test('saveStorageSettings round-trips and falls back to the default branch', () => {
      saveStorageSettings({ owner: 'acme', repo: 'specs', branch: '' });
      expect(getStorageSettings()).toEqual({
        owner: 'acme',
        repo: 'specs',
        branch: DEFAULT_BRANCH,
      });
    });

    test('saveStorageSettings always keeps the branch prefixed, even given a bare suffix', () => {
      saveStorageSettings({ owner: 'acme', repo: 'specs', branch: 'team-x' });
      expect(getStorageSettings()).toEqual({
        owner: 'acme',
        repo: 'specs',
        branch: 'aggregation-data-team-x',
      });
    });
  });

  describe('branch prefix helpers', () => {
    test('branchSuffixFromBranch strips the fixed prefix', () => {
      expect(branchSuffixFromBranch('aggregation-data-default')).toBe('default');
      expect(branchSuffixFromBranch('aggregation-data-team-x')).toBe('team-x');
    });

    test('branchSuffixFromBranch falls back to the whole value when unprefixed', () => {
      expect(branchSuffixFromBranch('main')).toBe('main');
      expect(branchSuffixFromBranch('')).toBe('');
      expect(branchSuffixFromBranch(null)).toBe('');
    });

    test('buildBranchName reattaches the prefix', () => {
      expect(buildBranchName('team-x')).toBe('aggregation-data-team-x');
      expect(buildBranchName('  team-x  ')).toBe('aggregation-data-team-x');
    });

    test('buildBranchName defaults to "default" for an empty suffix', () => {
      expect(buildBranchName('')).toBe(DEFAULT_BRANCH);
      expect(buildBranchName('   ')).toBe(DEFAULT_BRANCH);
      expect(buildBranchName(null)).toBe(DEFAULT_BRANCH);
    });

    test('branchSuffixFromBranch and buildBranchName round-trip', () => {
      expect(buildBranchName(branchSuffixFromBranch(DEFAULT_BRANCH))).toBe(DEFAULT_BRANCH);
      expect(DEFAULT_BRANCH.startsWith(BRANCH_PREFIX)).toBe(true);
    });
  });

  describe('anonymous reads (no PAT set)', () => {
    const NO_TOKEN_CONNECTION = { apiBaseUrl: 'https://api.github.com', token: '' };

    test('listAggregationSets succeeds against a public repo without sending an Authorization header', async () => {
      const setA = { name: 'A', swaggerUrls: [] };
      const calls = mockFetch([
        {
          method: 'GET',
          test: (u) => u.includes('/contents/aggregation-sets?'),
          json: [{ type: 'file', name: 'set-a.json' }],
        },
        {
          method: 'GET',
          test: (u) => u.includes('set-a.json'),
          json: { content: utf8ToBase64(JSON.stringify(setA)), sha: 'sha-a' },
        },
      ]);

      const result = await listAggregationSets(STORAGE, NO_TOKEN_CONNECTION);

      expect(result).toHaveLength(1);
      calls.forEach((call) => expect(call.headers.Authorization).toBeUndefined());
    });

    test('a request with a token still sends the Authorization header', async () => {
      const calls = mockFetch([{ method: 'GET', test: () => true, status: 404 }]);

      await listAggregationSets(STORAGE, CONNECTION);

      expect(calls[0].headers.Authorization).toBe('Bearer test-token');
    });
  });

  describe('ensureDataBranch', () => {
    test('does nothing when the branch ref already exists', async () => {
      const calls = mockFetch([
        {
          method: 'GET',
          test: (u) => u.includes('/git/refs/heads/'),
          status: 200,
          json: { ref: 'refs/heads/x' },
        },
      ]);

      await ensureDataBranch(STORAGE, CONNECTION);

      expect(calls).toHaveLength(1);
    });

    test('creates an orphan blob/tree/commit/ref when the branch is missing', async () => {
      const calls = mockFetch([
        { method: 'GET', test: (u) => u.includes('/git/refs/heads/'), status: 404 },
        { method: 'POST', test: (u) => u.endsWith('/git/blobs'), json: { sha: 'blob-sha' } },
        { method: 'POST', test: (u) => u.endsWith('/git/trees'), json: { sha: 'tree-sha' } },
        { method: 'POST', test: (u) => u.endsWith('/git/commits'), json: { sha: 'commit-sha' } },
        {
          method: 'POST',
          test: (u) => u.endsWith('/git/refs'),
          json: { ref: 'refs/heads/aggregation-data' },
        },
      ]);

      await ensureDataBranch(STORAGE, CONNECTION);

      expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'POST', 'POST', 'POST']);
      expect(calls[2].body.tree).toEqual([
        { path: 'README.md', mode: '100644', type: 'blob', sha: 'blob-sha' },
      ]);
      expect(calls[3].body).toEqual({
        message: 'Initialize aggregation data branch',
        tree: 'tree-sha',
        parents: [],
      });
      expect(calls[4].body).toEqual({ ref: `refs/heads/${DEFAULT_BRANCH}`, sha: 'commit-sha' });
    });
  });

  describe('getAggregationSet', () => {
    test('returns null when the file does not exist', async () => {
      mockFetch([{ method: 'GET', test: () => true, status: 404 }]);
      expect(await getAggregationSet('missing', STORAGE, CONNECTION)).toBeNull();
    });

    test('decodes UTF-8 content correctly (not just ASCII)', async () => {
      const record = {
        name: 'Café API 🚀',
        swaggerUrls: [{ name: 'Users', url: 'https://x/users.yaml' }],
      };
      mockFetch([
        {
          method: 'GET',
          test: () => true,
          json: { content: utf8ToBase64(JSON.stringify(record)), sha: 'file-sha' },
        },
      ]);

      const result = await getAggregationSet('set-1', STORAGE, CONNECTION);

      expect(result).toEqual({ ...record, id: 'set-1', sha: 'file-sha' });
    });

    test('a non-404 failure throws an error carrying the response status', async () => {
      mockFetch([{ method: 'GET', test: () => true, status: 403, statusText: 'Forbidden' }]);

      await expect(getAggregationSet('set-1', STORAGE, CONNECTION)).rejects.toMatchObject({
        status: 403,
      });
    });

    test('a 403 with an X-GitHub-SSO header carries the authorization url instead', async () => {
      const ssoUrl = 'https://github.com/orgs/octo-org/sso?authorization_request=abc123';
      mockFetch([
        {
          method: 'GET',
          test: () => true,
          status: 403,
          statusText: 'Forbidden',
          ssoHeader: `required; url=${ssoUrl}`,
        },
      ]);

      await expect(getAggregationSet('set-1', STORAGE, CONNECTION)).rejects.toMatchObject({
        status: 403,
        ssoUrl,
      });
    });
  });

  describe('doesBranchExist', () => {
    test('true when the ref exists', async () => {
      mockFetch([
        {
          method: 'GET',
          test: (u) => u.endsWith(`/git/refs/heads/${DEFAULT_BRANCH}`),
          json: { ref: `refs/heads/${DEFAULT_BRANCH}` },
        },
      ]);

      expect(await doesBranchExist(STORAGE, CONNECTION)).toBe(true);
    });

    test('false on a 404 (branch does not exist)', async () => {
      mockFetch([{ method: 'GET', test: () => true, status: 404 }]);
      expect(await doesBranchExist(STORAGE, CONNECTION)).toBe(false);
    });

    test('false if the request itself fails, rather than throwing', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await doesBranchExist(STORAGE, CONNECTION)).toBe(false);
    });
  });

  describe('canWriteToStorage', () => {
    test('true when the repo response reports push access', async () => {
      mockFetch([
        {
          method: 'GET',
          test: (u) => u.endsWith('/repos/taljacob2/swagger-editor-github'),
          json: { permissions: { push: true, pull: true } },
        },
      ]);

      expect(await canWriteToStorage(STORAGE, CONNECTION)).toBe(true);
    });

    test('false when permissions.push is false', async () => {
      mockFetch([
        {
          method: 'GET',
          test: (u) => u.endsWith('/repos/taljacob2/swagger-editor-github'),
          json: { permissions: { push: false, pull: true } },
        },
      ]);

      expect(await canWriteToStorage(STORAGE, CONNECTION)).toBe(false);
    });

    test('false when the permissions field is absent (anonymous request)', async () => {
      mockFetch([
        {
          method: 'GET',
          test: (u) => u.endsWith('/repos/taljacob2/swagger-editor-github'),
          json: {},
        },
      ]);

      const NO_TOKEN_CONNECTION = { apiBaseUrl: 'https://api.github.com', token: '' };
      expect(await canWriteToStorage(STORAGE, NO_TOKEN_CONNECTION)).toBe(false);
    });

    test('false on a 404 (repo not found or no read access)', async () => {
      mockFetch([{ method: 'GET', test: () => true, status: 404 }]);
      expect(await canWriteToStorage(STORAGE, CONNECTION)).toBe(false);
    });

    test('false if the request itself fails, rather than throwing', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await canWriteToStorage(STORAGE, CONNECTION)).toBe(false);
    });
  });

  describe('getRepoDefaultBranch', () => {
    test('returns the repo response default_branch', async () => {
      mockFetch([
        {
          method: 'GET',
          test: (u) => u.endsWith('/repos/taljacob2/swagger-editor-github'),
          json: { default_branch: 'main' },
        },
      ]);

      expect(await getRepoDefaultBranch(STORAGE, CONNECTION)).toBe('main');
    });

    test('null when the repo has no default_branch (unexpected response shape)', async () => {
      mockFetch([
        {
          method: 'GET',
          test: (u) => u.endsWith('/repos/taljacob2/swagger-editor-github'),
          json: {},
        },
      ]);

      expect(await getRepoDefaultBranch(STORAGE, CONNECTION)).toBeNull();
    });

    test('null on a 404, rather than throwing', async () => {
      mockFetch([{ method: 'GET', test: () => true, status: 404 }]);
      expect(await getRepoDefaultBranch(STORAGE, CONNECTION)).toBeNull();
    });

    test('null if the request itself fails, rather than throwing', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await getRepoDefaultBranch(STORAGE, CONNECTION)).toBeNull();
    });
  });

  describe('listAggregationSets', () => {
    test('returns an empty array when the directory does not exist', async () => {
      mockFetch([{ method: 'GET', test: () => true, status: 404 }]);
      expect(await listAggregationSets(STORAGE, CONNECTION)).toEqual([]);
    });

    test('fetches each .json entry, ignores non-json entries, sorts newest first', async () => {
      const setA = { name: 'A', swaggerUrls: [], updatedAt: '2026-01-01T00:00:00.000Z' };
      const setB = { name: 'B', swaggerUrls: [], updatedAt: '2026-06-01T00:00:00.000Z' };

      mockFetch([
        {
          method: 'GET',
          test: (u) => u.includes(`/contents/aggregation-sets?`),
          json: [
            { type: 'file', name: 'set-a.json' },
            { type: 'file', name: 'set-b.json' },
            { type: 'file', name: 'README.md' },
          ],
        },
        {
          method: 'GET',
          test: (u) => u.includes('set-a.json'),
          json: { content: utf8ToBase64(JSON.stringify(setA)), sha: 'sha-a' },
        },
        {
          method: 'GET',
          test: (u) => u.includes('set-b.json'),
          json: { content: utf8ToBase64(JSON.stringify(setB)), sha: 'sha-b' },
        },
      ]);

      const result = await listAggregationSets(STORAGE, CONNECTION);

      expect(result.map((s) => s.id)).toEqual(['set-b', 'set-a']);
    });
  });

  describe('saveAggregationSet', () => {
    test('creates a new set without a sha, generating an id', async () => {
      const calls = mockFetch([
        { method: 'GET', test: (u) => u.includes('/git/refs/heads/'), status: 200, json: {} },
        { method: 'GET', test: (u) => u.includes('/contents/aggregation-sets/'), status: 404 },
        {
          method: 'PUT',
          test: (u) => u.includes('/contents/aggregation-sets/'),
          json: { content: { sha: 'new-sha' } },
        },
      ]);

      const result = await saveAggregationSet(
        { name: 'Orders', swaggerUrls: [{ name: 'Orders', url: 'https://x/orders.yaml' }] },
        STORAGE,
        CONNECTION
      );

      expect(result.id).toBeTruthy();
      expect(result.sha).toBe('new-sha');
      expect(result.createdAt).toBe(result.updatedAt);

      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall.body.sha).toBeUndefined();
      expect(putCall.body.branch).toBe(DEFAULT_BRANCH);
    });

    test('updates an existing set, preserving createdAt and sending its sha', async () => {
      const existing = {
        name: 'Orders',
        swaggerUrls: [],
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      };
      const calls = mockFetch([
        { method: 'GET', test: (u) => u.includes('/git/refs/heads/'), status: 200, json: {} },
        {
          method: 'GET',
          test: (u) => u.includes('/contents/aggregation-sets/'),
          json: { content: utf8ToBase64(JSON.stringify(existing)), sha: 'old-sha' },
        },
        {
          method: 'PUT',
          test: (u) => u.includes('/contents/aggregation-sets/'),
          json: { content: { sha: 'updated-sha' } },
        },
      ]);

      const result = await saveAggregationSet(
        { id: 'set-1', name: 'Orders v2', swaggerUrls: [] },
        STORAGE,
        CONNECTION
      );

      expect(result.createdAt).toBe('2020-01-01T00:00:00.000Z');
      expect(result.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');

      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall.body.sha).toBe('old-sha');
    });

    test('a stale sha throws a friendlier message instead of a raw 409', async () => {
      const existing = { name: 'Orders', swaggerUrls: [], createdAt: '2020-01-01T00:00:00.000Z' };
      mockFetch([
        { method: 'GET', test: (u) => u.includes('/git/refs/heads/'), status: 200, json: {} },
        {
          method: 'GET',
          test: (u) => u.includes('/contents/aggregation-sets/'),
          json: { content: utf8ToBase64(JSON.stringify(existing)), sha: 'old-sha' },
        },
        {
          method: 'PUT',
          test: (u) => u.includes('/contents/aggregation-sets/'),
          status: 409,
          statusText: 'Conflict',
        },
      ]);

      await expect(
        saveAggregationSet({ id: 'set-1', name: 'Orders v2', swaggerUrls: [] }, STORAGE, CONNECTION)
      ).rejects.toMatchObject({
        status: 409,
        message:
          'This was updated elsewhere since you loaded it. Reload it and reapply your changes before saving again.',
      });
    });
  });

  describe('deleteAggregationSet', () => {
    test('does nothing when the set does not exist', async () => {
      const calls = mockFetch([{ method: 'GET', test: () => true, status: 404 }]);
      await deleteAggregationSet('missing', STORAGE, CONNECTION);
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    test('deletes with the current sha and a descriptive message', async () => {
      const existing = { name: 'Orders', swaggerUrls: [] };
      const calls = mockFetch([
        {
          method: 'GET',
          test: () => true,
          json: { content: utf8ToBase64(JSON.stringify(existing)), sha: 'sha-to-delete' },
        },
        { method: 'DELETE', test: () => true, json: {} },
      ]);

      await deleteAggregationSet('set-1', STORAGE, CONNECTION);

      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall.body).toEqual({
        message: 'Delete aggregation set "Orders"',
        sha: 'sha-to-delete',
        branch: DEFAULT_BRANCH,
      });
    });
  });

  describe('moveSwaggerUrl', () => {
    const urls = (...names) => names.map((name) => ({ name, url: `https://example.com/${name}` }));

    test('moves an entry up, swapping it with its predecessor', () => {
      const result = moveSwaggerUrl(urls('a', 'b', 'c'), 1, 'up');
      expect(result.map((e) => e.name)).toEqual(['b', 'a', 'c']);
    });

    test('moves an entry down, swapping it with its successor', () => {
      const result = moveSwaggerUrl(urls('a', 'b', 'c'), 1, 'down');
      expect(result.map((e) => e.name)).toEqual(['a', 'c', 'b']);
    });

    test('moving the first entry up is a no-op, same reference', () => {
      const input = urls('a', 'b');
      expect(moveSwaggerUrl(input, 0, 'up')).toBe(input);
    });

    test('moving the last entry down is a no-op, same reference', () => {
      const input = urls('a', 'b');
      expect(moveSwaggerUrl(input, 1, 'down')).toBe(input);
    });

    test('a single-entry list is a no-op in either direction', () => {
      const input = urls('a');
      expect(moveSwaggerUrl(input, 0, 'up')).toBe(input);
      expect(moveSwaggerUrl(input, 0, 'down')).toBe(input);
    });

    test('does not mutate the original array', () => {
      const input = urls('a', 'b');
      moveSwaggerUrl(input, 0, 'down');
      expect(input.map((e) => e.name)).toEqual(['a', 'b']);
    });
  });

  describe('getSwaggerUrlWarning', () => {
    test('returns null for an empty or whitespace-only value', () => {
      expect(getSwaggerUrlWarning('')).toBeNull();
      expect(getSwaggerUrlWarning('   ')).toBeNull();
    });

    test('returns null for a URL ending in a recognized spec-file extension', () => {
      expect(getSwaggerUrlWarning('https://example.com/owner/repo/openapi.yaml')).toBeNull();
      expect(getSwaggerUrlWarning('https://example.com/owner/repo/openapi.yml')).toBeNull();
      expect(getSwaggerUrlWarning('https://example.com/owner/repo/openapi.json')).toBeNull();
      // Case-insensitive, and tolerant of a trailing query string.
      expect(getSwaggerUrlWarning('https://example.com/openapi.YAML')).toBeNull();
      expect(getSwaggerUrlWarning('https://example.com/openapi.yaml?ref=main')).toBeNull();
    });

    test('flags a value that is not a valid URL at all', () => {
      expect(getSwaggerUrlWarning('not a url')).toBe("Doesn't look like a valid URL.");
    });

    // The exact scenario this was added for: a raw URL pasted with its tail
    // cut off, which happens to have no extension at the point it was cut.
    test('flags a URL truncated mid-path, with no extension', () => {
      expect(
        getSwaggerUrlWarning(
          'https://raw.tradeone.ghe.com/ea-financial/platform-market/refs/heads/migrate-swagger-to-'
        )
      ).toMatch(/cut off/);
    });

    test('flags a URL with no recognized spec-file extension', () => {
      expect(getSwaggerUrlWarning('https://example.com/owner/repo')).toMatch(/spec file/);
    });
  });
});
