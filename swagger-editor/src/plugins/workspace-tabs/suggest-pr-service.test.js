import { describe, expect, test, vi } from 'vitest';

import {
  buildSuggestionBranchName,
  canWriteToRepo,
  createPullRequest,
  createSuggestionBranch,
  diffLines,
  MAX_DIFFABLE_LINES,
} from './suggest-pr-service.js';

const CONNECTION = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };

function mockFetch(routes) {
  const calls = [];
  global.fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
    const route = routes.find((r) => r.method === method && r.test(url));
    if (!route) {
      throw new Error(`Unmocked request: ${method} ${url}`);
    }
    if (route.status && route.status >= 400) {
      return {
        ok: false,
        status: route.status,
        statusText: 'Error',
        text: async () => '',
        headers: { get: () => null },
      };
    }
    return { ok: true, status: 200, json: async () => route.json };
  });
  return calls;
}

describe('diffLines', () => {
  test('an unchanged file is all context lines', () => {
    const text = 'a\nb\nc';

    expect(diffLines(text, text)).toEqual([
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
      { type: 'context', text: 'c' },
    ]);
  });

  test('a single changed line shows as a removal plus an addition', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'B' },
      { type: 'context', text: 'c' },
    ]);
  });

  test('an appended line shows as a trailing addition', () => {
    expect(diffLines('a\nb', 'a\nb\nc')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
      { type: 'added', text: 'c' },
    ]);
  });

  test('a removed line shows as a removal with nothing added in its place', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'context', text: 'c' },
    ]);
  });

  test('returns null instead of diffing when either side exceeds the line cap', () => {
    const huge = new Array(MAX_DIFFABLE_LINES + 1).fill('x').join('\n');

    expect(diffLines(huge, 'a')).toBeNull();
    expect(diffLines('a', huge)).toBeNull();
  });
});

describe('buildSuggestionBranchName', () => {
  test('is prefixed distinctly and unique across calls', () => {
    const a = buildSuggestionBranchName();
    const b = buildSuggestionBranchName();

    expect(a).toMatch(/^swagger-editor-suggestion-/);
    expect(a).not.toBe(b);
  });
});

describe('canWriteToRepo', () => {
  test('reflects permissions.push', async () => {
    mockFetch([{ method: 'GET', test: () => true, json: { permissions: { push: true } } }]);

    expect(await canWriteToRepo('owner', 'repo', CONNECTION)).toBe(true);
  });

  test('is false when permissions are absent (e.g. no token)', async () => {
    mockFetch([{ method: 'GET', test: () => true, json: {} }]);

    expect(await canWriteToRepo('owner', 'repo', CONNECTION)).toBe(false);
  });
});

describe('createSuggestionBranch', () => {
  test('walks blob -> tree -> commit -> ref off the base branch', async () => {
    const calls = mockFetch([
      {
        method: 'GET',
        test: (u) => u.includes('/git/refs/heads/main'),
        json: { object: { sha: 'base-ref-sha' } },
      },
      {
        method: 'GET',
        test: (u) => u.includes('/git/commits/base-ref-sha'),
        json: { tree: { sha: 'base-tree-sha' } },
      },
      { method: 'POST', test: (u) => u.endsWith('/git/blobs'), json: { sha: 'blob-sha' } },
      { method: 'POST', test: (u) => u.endsWith('/git/trees'), json: { sha: 'tree-sha' } },
      { method: 'POST', test: (u) => u.endsWith('/git/commits'), json: { sha: 'commit-sha' } },
      {
        method: 'POST',
        test: (u) => u.endsWith('/git/refs'),
        json: { ref: 'refs/heads/new-branch' },
      },
    ]);

    await createSuggestionBranch(
      {
        owner: 'owner',
        repo: 'repo',
        baseRef: 'main',
        path: 'openapi.yaml',
        content: 'openapi: 3.0.0\n',
        branchName: 'swagger-editor-suggestion-x',
        commitMessage: 'Update openapi.yaml',
      },
      CONNECTION
    );

    const treeCall = calls.find((c) => c.url.endsWith('/git/trees'));
    expect(treeCall.body).toEqual({
      base_tree: 'base-tree-sha',
      tree: [{ path: 'openapi.yaml', mode: '100644', type: 'blob', sha: 'blob-sha' }],
    });
    const commitCall = calls.find((c) => c.url.endsWith('/git/commits'));
    expect(commitCall.body).toEqual({
      message: 'Update openapi.yaml',
      tree: 'tree-sha',
      parents: ['base-ref-sha'],
    });
    const refCall = calls.find((c) => c.url.endsWith('/git/refs'));
    expect(refCall.body).toEqual({
      ref: 'refs/heads/swagger-editor-suggestion-x',
      sha: 'commit-sha',
    });
  });
});

describe('createPullRequest', () => {
  test('posts to the pulls endpoint and returns the PR URL', async () => {
    const calls = mockFetch([
      {
        method: 'POST',
        test: (u) => u.endsWith('/pulls'),
        json: { html_url: 'https://github.com/owner/repo/pull/42' },
      },
    ]);

    const url = await createPullRequest(
      {
        owner: 'owner',
        repo: 'repo',
        title: 'Update openapi.yaml',
        body: 'body',
        base: 'main',
        head: 'branch',
      },
      CONNECTION
    );

    expect(url).toBe('https://github.com/owner/repo/pull/42');
    expect(calls[0].body).toEqual({
      title: 'Update openapi.yaml',
      body: 'body',
      base: 'main',
      head: 'branch',
    });
  });
});
