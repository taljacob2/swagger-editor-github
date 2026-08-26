import { describe, expect, test, vi, beforeEach } from 'vitest';
import { readFile, options as apidomReferenceOptions } from '@swagger-api/apidom-reference';

import GitHubResolver, { buildResolvers } from './github-resolver.js';

describe('GitHubResolver', () => {
  describe('canRead', () => {
    test('recognizes a GitHub raw URL', () => {
      const resolver = new GitHubResolver({ apiBaseUrl: 'https://api.github.com' });
      expect(resolver.canRead({ uri: 'https://raw.githubusercontent.com/o/r/main/x.yaml' })).toBe(
        true
      );
    });

    test('recognizes a GitHub blob URL', () => {
      const resolver = new GitHubResolver({ apiBaseUrl: 'https://api.github.com' });
      expect(resolver.canRead({ uri: 'https://github.com/o/r/blob/main/x.yaml' })).toBe(true);
    });

    test('rejects an unrelated third-party URL', () => {
      const resolver = new GitHubResolver({ apiBaseUrl: 'https://api.github.com' });
      expect(resolver.canRead({ uri: 'https://example.com/x.yaml' })).toBe(false);
    });
  });

  describe('read', () => {
    beforeEach(() => {
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ content: btoa('openapi: 3.0.0\n') }),
      }));
    });

    test('rewrites to the Contents API and attaches the token', async () => {
      const resolver = new GitHubResolver({ apiBaseUrl: 'https://api.github.com', token: 'tok' });
      const buffer = await resolver.read({
        uri: 'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
      });

      expect(buffer.toString('utf-8')).toBe('openapi: 3.0.0\n');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=main',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer tok',
          },
        }
      );
    });

    test('omits the Authorization header when no token is configured', async () => {
      const resolver = new GitHubResolver({ apiBaseUrl: 'https://api.github.com' });
      await resolver.read({ uri: 'https://raw.githubusercontent.com/owner/repo/main/x.yaml' });

      expect(global.fetch).toHaveBeenCalledWith(expect.any(String), {
        headers: { Accept: 'application/vnd.github+json' },
      });
    });

    test('throws on a non-OK response instead of returning something apidom-reference would silently mishandle', async () => {
      global.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));
      const resolver = new GitHubResolver({ apiBaseUrl: 'https://api.github.com' });

      await expect(
        resolver.read({ uri: 'https://raw.githubusercontent.com/owner/repo/main/x.yaml' })
      ).rejects.toThrow('404');
    });
  });
});

describe('buildResolvers', () => {
  test('prepends a GitHubResolver ahead of apidom-reference’s own default resolvers', () => {
    const resolvers = buildResolvers({ apiBaseUrl: 'https://api.github.com', token: 'tok' });

    expect(resolvers[0]).toBeInstanceOf(GitHubResolver);
    expect(resolvers.slice(1)).toEqual(apidomReferenceOptions.resolve.resolvers);
  });

  test('still returns a usable resolver list with no connection settings at all', () => {
    const resolvers = buildResolvers();
    expect(resolvers[0]).toBeInstanceOf(GitHubResolver);
  });
});

// Exercises the real apidom-reference resolver-selection/execution pipeline
// (plugins.filter('canRead')/plugins.run('read')) end to end, with only
// global.fetch mocked -- not apidom-reference's own internals -- so this
// actually proves GitHubResolver wins for a GitHub-shaped URL ahead of the
// default HTTP resolver, rather than just asserting it in isolation.
describe('GitHubResolver wired into apidom-reference (integration)', () => {
  test('a real readFile() call picks the GitHubResolver and authenticates via the Contents API', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: btoa('hello: world\n') }),
    }));

    const buffer = await readFile(
      'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
      {
        resolve: {
          resolvers: buildResolvers({ apiBaseUrl: 'https://api.github.com', token: 'itg-token' }),
        },
      }
    );

    expect(buffer.toString()).toBe('hello: world\n');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=main',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer itg-token' }),
      })
    );
  });
});
