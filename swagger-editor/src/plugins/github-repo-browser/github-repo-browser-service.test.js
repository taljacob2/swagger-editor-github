import { describe, expect, test, vi } from 'vitest';

import {
  getFileContent,
  listBranches,
  listRepos,
  listSpecFiles,
} from './github-repo-browser-service.js';

const CONNECTION = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };

const utf8ToBase64 = (text) => Buffer.from(text, 'utf8').toString('base64');

function mockFetch(routes) {
  const calls = [];
  global.fetch = vi.fn(async (url) => {
    calls.push(url);
    const route = routes.find((r) => r.test(url));
    if (!route) {
      throw new Error(`Unmocked request: ${url}`);
    }
    return { ok: true, status: 200, json: async () => route.json };
  });
  return calls;
}

describe('listRepos', () => {
  test('follows pagination until a short page is returned', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ full_name: `owner/repo-${i}` }));
    const page2 = [{ full_name: 'owner/repo-100' }];
    const calls = mockFetch([
      { test: (u) => new URL(u).searchParams.get('page') === '1', json: page1 },
      { test: (u) => new URL(u).searchParams.get('page') === '2', json: page2 },
    ]);

    const repos = await listRepos(CONNECTION);

    expect(repos).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  test('stops after one page when it comes back short', async () => {
    mockFetch([{ test: () => true, json: [{ full_name: 'owner/repo' }] }]);

    const repos = await listRepos(CONNECTION);

    expect(repos).toEqual([{ full_name: 'owner/repo' }]);
  });
});

describe('listBranches', () => {
  test('lists branches for a repo', async () => {
    mockFetch([
      {
        test: (u) => u.includes('/repos/owner/repo/branches'),
        json: [{ name: 'main' }, { name: 'dev' }],
      },
    ]);

    const branches = await listBranches('owner', 'repo', CONNECTION);

    expect(branches).toEqual([{ name: 'main' }, { name: 'dev' }]);
  });
});

describe('listSpecFiles', () => {
  test('filters the recursive tree to any .yaml/.yml/.json blob, regardless of filename', async () => {
    mockFetch([
      {
        test: (u) => u.includes('/git/trees/main'),
        json: {
          tree: [
            { path: 'openapi.yaml', type: 'blob' },
            { path: 'services/billing/swagger.json', type: 'blob' },
            // Real repos name specs all sorts of ways -- not just
            // swagger.*/openapi.* -- so these must be included too.
            { path: 'orders.yaml', type: 'blob' },
            { path: 'ref-user.yaml', type: 'blob' },
            { path: 'README.md', type: 'blob' },
            { path: 'src', type: 'tree' },
            { path: 'openapi.yml', type: 'blob' },
          ],
        },
      },
    ]);

    const files = await listSpecFiles('owner', 'repo', 'main', CONNECTION);

    expect(files).toEqual([
      { path: 'openapi.yaml', ref: 'main' },
      { path: 'services/billing/swagger.json', ref: 'main' },
      { path: 'orders.yaml', ref: 'main' },
      { path: 'ref-user.yaml', ref: 'main' },
      { path: 'openapi.yml', ref: 'main' },
    ]);
  });
});

describe('getFileContent', () => {
  test('decodes the base64 Contents API envelope', async () => {
    mockFetch([
      {
        test: (u) => u.includes('/contents/openapi.yaml'),
        json: { content: utf8ToBase64('openapi: 3.0.0\n'), sha: 'abc123' },
      },
    ]);

    const result = await getFileContent('owner', 'repo', 'openapi.yaml', 'main', CONNECTION);

    expect(result).toEqual({ content: 'openapi: 3.0.0\n', sha: 'abc123' });
  });
});
