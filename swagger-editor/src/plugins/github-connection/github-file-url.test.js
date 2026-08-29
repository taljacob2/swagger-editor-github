import parseGitHubFileUrl, { buildGitHubFileUrl } from './github-file-url.js';

describe('buildGitHubFileUrl', () => {
  test('reconstructs a github.com blob URL', () => {
    expect(
      buildGitHubFileUrl({
        apiBaseUrl: 'https://api.github.com',
        owner: 'octo-org',
        repo: 'petstore',
        path: 'openapi.yaml',
        ref: 'main',
      })
    ).toBe('https://github.com/octo-org/petstore/blob/main/openapi.yaml');
  });

  test('reconstructs a GHE.com custom-domain blob URL', () => {
    expect(
      buildGitHubFileUrl({
        apiBaseUrl: 'https://api.example.ghe.com',
        owner: 'octo-org',
        repo: 'petstore',
        path: 'specs/openapi.yaml',
        ref: 'main',
      })
    ).toBe('https://example.ghe.com/octo-org/petstore/blob/main/specs/openapi.yaml');
  });

  test('round-trips with parseGitHubFileUrl', () => {
    const target = {
      apiBaseUrl: 'https://api.github.com',
      owner: 'octo-org',
      repo: 'petstore',
      path: 'nested/openapi.yaml',
      ref: 'develop',
    };

    const url = buildGitHubFileUrl(target);
    const parsed = parseGitHubFileUrl(url, target.apiBaseUrl);

    expect(parsed).toEqual({
      owner: target.owner,
      repo: target.repo,
      path: target.path,
      ref: target.ref,
      apiBase: target.apiBaseUrl,
    });
  });

  test('returns null for an unparseable apiBaseUrl', () => {
    expect(
      buildGitHubFileUrl({
        apiBaseUrl: 'not a url',
        owner: 'octo-org',
        repo: 'petstore',
        path: 'openapi.yaml',
        ref: 'main',
      })
    ).toBeNull();
  });
});
