import { describe, expect, test, vi } from 'vitest';

import { ghRequest } from './github-api-client.js';

const CONNECTION = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };

function mockFetchOnce({ status = 200, json, ssoHeader, detail } = {}) {
  global.fetch = vi.fn(async () => ({
    ok: status < 400,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    json: async () => json,
    text: async () => detail || '',
    headers: { get: (name) => (name === 'X-GitHub-SSO' ? ssoHeader || null : null) },
  }));
}

describe('ghRequest', () => {
  test('sends a bearer token and Accept header, and returns the parsed body', async () => {
    mockFetchOnce({ json: { login: 'octocat' } });

    const result = await ghRequest('/user', { connection: CONNECTION });

    expect(result).toEqual({ login: 'octocat' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/user');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(options.headers.Accept).toBe('application/vnd.github+json');
  });

  test('omits Authorization entirely when there is no token', async () => {
    mockFetchOnce({ json: {} });

    await ghRequest('/user', { connection: { apiBaseUrl: 'https://api.github.com', token: '' } });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  test('returns null on a 404 when allow404 is set', async () => {
    mockFetchOnce({ status: 404 });

    const result = await ghRequest('/repos/owner/missing', {
      connection: CONNECTION,
      allow404: true,
    });

    expect(result).toBeNull();
  });

  test('throws with a friendlier message on a 409 conflict', async () => {
    mockFetchOnce({ status: 409 });

    await expect(
      ghRequest('/repos/owner/repo/contents/x', { connection: CONNECTION })
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This was updated elsewhere since you loaded it. Reload it and reapply your changes before saving again.',
    });
  });

  test('surfaces an SSO authorization URL from the X-GitHub-SSO header', async () => {
    mockFetchOnce({ status: 403, ssoHeader: 'partial-results; url=https://github.com/orgs/x/sso' });

    await expect(ghRequest('/user', { connection: CONNECTION })).rejects.toMatchObject({
      status: 403,
      ssoUrl: 'https://github.com/orgs/x/sso',
    });
  });

  test('extracts a clean message from a GitHub JSON error body instead of dumping it raw', async () => {
    mockFetchOnce({
      status: 403,
      detail: JSON.stringify({
        message: 'API rate limit exceeded for 79.177.133.201.',
        documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api',
      }),
    });

    await expect(ghRequest('/user/repos', { connection: CONNECTION })).rejects.toMatchObject({
      status: 403,
      message:
        'GitHub API GET /user/repos failed (403): API rate limit exceeded for 79.177.133.201.',
    });
  });

  test('falls back to the raw body when the error response is not JSON', async () => {
    mockFetchOnce({ status: 502, detail: '<html>Bad Gateway</html>' });

    await expect(ghRequest('/user', { connection: CONNECTION })).rejects.toMatchObject({
      status: 502,
      message: 'GitHub API GET /user failed (502): <html>Bad Gateway</html>',
    });
  });

  test('returns null on a 204', async () => {
    mockFetchOnce({ status: 204 });

    const result = await ghRequest('/repos/owner/repo/contents/x', {
      connection: CONNECTION,
      method: 'DELETE',
    });

    expect(result).toBeNull();
  });
});
