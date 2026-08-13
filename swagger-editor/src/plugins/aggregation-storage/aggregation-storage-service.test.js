import {
  DEFAULT_BRANCH,
  deleteAggregationSet,
  ensureDataBranch,
  getAggregationSet,
  getStorageSettings,
  listAggregationSets,
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
    if (route.status === 404) {
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'Not Found' };
    }
    return {
      ok: true,
      status: route.status || 200,
      json: async () => route.json,
    };
  });
  return calls;
}

describe('aggregation-storage-service', () => {
  beforeEach(() => {
    localStorage.clear();
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

    test('saveStorageSettings round-trips and falls back to the default branch', () => {
      saveStorageSettings({ owner: 'acme', repo: 'specs', branch: '' });
      expect(getStorageSettings()).toEqual({
        owner: 'acme',
        repo: 'specs',
        branch: DEFAULT_BRANCH,
      });
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
      expect(calls[4].body).toEqual({ ref: 'refs/heads/aggregation-data', sha: 'commit-sha' });
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
});
