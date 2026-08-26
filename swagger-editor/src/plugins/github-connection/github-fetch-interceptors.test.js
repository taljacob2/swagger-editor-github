import { describe, expect, test, beforeEach } from 'vitest';

import {
  githubRequestInterceptor,
  githubResponseInterceptor,
} from './github-fetch-interceptors.js';
import { DEFAULT_API_BASE_URL, saveConnectionSettings } from './github-connection-service.js';

describe('githubRequestInterceptor', () => {
  beforeEach(async () => {
    localStorage.clear();
    await saveConnectionSettings({ apiBaseUrl: DEFAULT_API_BASE_URL, token: 'repo-token' });
  });

  test('rewrites a raw GitHub URL into an authenticated Contents API request', async () => {
    const request = {
      url: 'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
      headers: {},
    };

    const result = await githubRequestInterceptor(request);

    expect(result.url).toBe(
      'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=main'
    );
    expect(result.headers).toEqual({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer repo-token',
    });
  });

  test('prefers a dedicated fetchToken over the main token', async () => {
    await saveConnectionSettings({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      token: 'repo-token',
      fetchToken: 'read-only-token',
    });

    const result = await githubRequestInterceptor({
      url: 'https://raw.githubusercontent.com/owner/repo/main/openapi.yaml',
      headers: {},
    });

    expect(result.headers.Authorization).toBe('Bearer read-only-token');
  });

  test('leaves an unrelated URL untouched', async () => {
    const request = { url: 'https://example.com/openapi.yaml', headers: { 'X-Foo': 'bar' } };

    const result = await githubRequestInterceptor(request);

    expect(result).toBe(request);
    expect(result.url).toBe('https://example.com/openapi.yaml');
    expect(result.headers).toEqual({ 'X-Foo': 'bar' });
  });
});

describe('githubResponseInterceptor', () => {
  test('decodes a Contents API base64 envelope into the parsed spec fragment', async () => {
    const response = {
      url: 'https://api.github.com/repos/owner/repo/contents/openapi.yaml?ref=main',
      obj: { content: btoa('openapi: 3.0.0\ninfo:\n  title: X\n'), encoding: 'base64' },
    };

    const result = await githubResponseInterceptor(response);

    expect(result.text).toBe('openapi: 3.0.0\ninfo:\n  title: X\n');
    expect(result.data).toBe('openapi: 3.0.0\ninfo:\n  title: X\n');
    expect(result.body).toEqual({ openapi: '3.0.0', info: { title: 'X' } });
    expect(result.obj).toEqual({ openapi: '3.0.0', info: { title: 'X' } });
  });

  test('leaves a non-Contents-API response untouched', async () => {
    const response = {
      url: 'https://api.example.com/pets',
      obj: { pets: [] },
    };

    const result = await githubResponseInterceptor(response);

    expect(result).toBe(response);
    expect(result.obj).toEqual({ pets: [] });
  });

  test('leaves a Contents API response for a non-file (e.g. a directory listing) untouched', async () => {
    const response = {
      url: 'https://api.github.com/repos/owner/repo/contents/some-dir?ref=main',
      obj: [{ name: 'openapi.yaml' }],
    };

    const result = await githubResponseInterceptor(response);

    expect(result).toBe(response);
  });
});
