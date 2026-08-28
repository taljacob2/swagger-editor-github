import {
  DEFAULT_API_BASE_URL,
  buildClassicTokenCreationUrl,
  buildTokenCreationUrl,
  deriveWebBaseUrl,
  getCachedConnectionSettingsForWorkers,
  getConnectionSettings,
  parseSsoAuthorizationUrl,
  saveConnectionSettings,
  setCachedConnectionSettingsForWorkers,
  testConnection,
} from './github-connection-service.js';

describe('github-connection-service', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
    setCachedConnectionSettingsForWorkers(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('getConnectionSettings', () => {
    test('defaults to api.github.com with no tokens when nothing is stored', async () => {
      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
        rawToken: '',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('falls back to defaults when localStorage holds invalid JSON', async () => {
      localStorage.setItem('github-editor:connection', 'not json');
      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
        rawToken: '',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('still reads a pre-existing plain-text token (written before encryption was added)', async () => {
      localStorage.setItem(
        'github-editor:connection',
        JSON.stringify({ apiBaseUrl: DEFAULT_API_BASE_URL, token: 'legacy-plain-token' })
      );

      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'legacy-plain-token',
        rawToken: 'legacy-plain-token',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('defaults to the build-time VITE_GITHUB_API_BASE_URL when nothing is stored', async () => {
      vi.stubEnv('VITE_GITHUB_API_BASE_URL', 'https://api.mycompany.ghe.com/');

      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: 'https://api.mycompany.ghe.com',
        token: '',
        rawToken: '',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('a silenced token is hidden from token but still readable via rawToken', async () => {
      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'silenced-token',
        tokenDisabled: true,
      });

      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
        rawToken: 'silenced-token',
        fetchToken: '',
        tokenDisabled: true,
      });
    });

    test('an explicit saved apiBaseUrl still wins over the build-time default', async () => {
      vi.stubEnv('VITE_GITHUB_API_BASE_URL', 'https://api.mycompany.ghe.com');
      await saveConnectionSettings({ apiBaseUrl: 'https://api.github.com', token: '' });

      expect((await getConnectionSettings()).apiBaseUrl).toBe('https://api.github.com');
    });
  });

  describe('saveConnectionSettings', () => {
    test('round-trips through localStorage and strips a trailing slash', async () => {
      await saveConnectionSettings({
        apiBaseUrl: 'https://api.mycompany.ghe.com/',
        token: 'good-token',
      });

      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: 'https://api.mycompany.ghe.com',
        token: 'good-token',
        rawToken: 'good-token',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('encrypts the token at rest, rather than storing it as plain text', async () => {
      await saveConnectionSettings({ apiBaseUrl: DEFAULT_API_BASE_URL, token: 'super-secret-pat' });

      const stored = JSON.parse(localStorage.getItem('github-editor:connection'));
      expect(stored.token).not.toBe('super-secret-pat');
      expect(stored.token).not.toContain('super-secret-pat');

      // still decrypts back to the original value via getConnectionSettings
      expect((await getConnectionSettings()).token).toBe('super-secret-pat');
    });

    test('falls back to plain text for an empty token instead of crashing', async () => {
      await saveConnectionSettings({ apiBaseUrl: DEFAULT_API_BASE_URL, token: '' });
      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
        rawToken: '',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('round-trips and encrypts fetchToken independently of token', async () => {
      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'repo-token-value',
        fetchToken: 'fetch-token-value',
      });

      const stored = JSON.parse(localStorage.getItem('github-editor:connection'));
      expect(stored.fetchToken).not.toBe('fetch-token-value');
      expect(stored.fetchToken).not.toContain('fetch-token-value');
      expect(stored.token).not.toBe(stored.fetchToken);

      const settings = await getConnectionSettings();
      expect(settings.token).toBe('repo-token-value');
      expect(settings.fetchToken).toBe('fetch-token-value');
    });

    // Never guessed from length/base64-decodability (a real PAT could satisfy
    // that by coincidence) -- only this module's own "enc:v1:" prefix marks a
    // stored value as encrypted, so a realistic PAT is always read back as-is.
    test.each([
      ['classic', 'ghp_1234567890abcdefghijklmnopqrstuvwxyz12'],
      ['fine-grained', 'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
      ['OAuth', 'gho_1234567890abcdefghijklmnopqrstuvwxyz12'],
    ])(
      'round-trips a realistic-looking %s PAT as plain text, unmisidentified as encrypted',
      async (_kind, pat) => {
        localStorage.setItem(
          'github-editor:connection',
          JSON.stringify({ apiBaseUrl: DEFAULT_API_BASE_URL, token: pat })
        );
        expect((await getConnectionSettings()).token).toBe(pat);
      }
    );

    test('encryption failure is logged and surfaced via the returned tokenEncrypted flag, not silent', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const encryptSpy = vi
        .spyOn(window.crypto.subtle, 'encrypt')
        .mockRejectedValue(new Error('key unavailable'));

      const result = await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'super-secret-pat',
      });

      expect(result.tokenEncrypted).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unencrypted'),
        expect.any(Error)
      );
      // Still usable -- the token itself isn't lost, just unencrypted at rest.
      expect((await getConnectionSettings()).token).toBe('super-secret-pat');
      const stored = JSON.parse(localStorage.getItem('github-editor:connection'));
      expect(stored.token).toBe('super-secret-pat');

      encryptSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('a successful encryption reports tokenEncrypted/fetchTokenEncrypted as true', async () => {
      const result = await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'a-token',
        fetchToken: 'a-fetch-token',
      });

      expect(result.tokenEncrypted).toBe(true);
      expect(result.fetchTokenEncrypted).toBe(true);
    });

    test('saving a new token does not clobber a previously saved fetchToken, or vice versa', async () => {
      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'first-token',
        fetchToken: 'first-fetch-token',
      });

      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'second-token',
        fetchToken: 'first-fetch-token',
      });

      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'second-token',
        rawToken: 'second-token',
        fetchToken: 'first-fetch-token',
        tokenDisabled: false,
      });
    });

    test('silencing keeps the stored token but zeroes the effective one; re-enabling restores it', async () => {
      await saveConnectionSettings({ apiBaseUrl: DEFAULT_API_BASE_URL, token: 'a-pat' });
      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'a-pat',
        tokenDisabled: true,
      });

      let settings = await getConnectionSettings();
      expect(settings.token).toBe('');
      expect(settings.rawToken).toBe('a-pat');
      expect(settings.tokenDisabled).toBe(true);

      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'a-pat',
        tokenDisabled: false,
      });

      settings = await getConnectionSettings();
      expect(settings.token).toBe('a-pat');
      expect(settings.tokenDisabled).toBe(false);
    });
  });

  // apidom-mode.js's worker() reads this on essentially every keystroke to
  // decide whether the ApiDOM worker needs fresh GitHub credentials pushed
  // in -- see github-resolver.js and the CORS note in
  // aggregation-merge-service.js for why the worker needs them at all. This
  // exists purely so that path doesn't pay a decrypt (getConnectionSettings)
  // on every single call.
  describe('getCachedConnectionSettingsForWorkers / setCachedConnectionSettingsForWorkers', () => {
    test('starts empty until something populates it', () => {
      expect(getCachedConnectionSettingsForWorkers()).toBeNull();
    });

    test('saveConnectionSettings populates the cache with the plaintext (not encrypted) settings', async () => {
      await saveConnectionSettings({ apiBaseUrl: DEFAULT_API_BASE_URL, token: 'plain-token' });

      expect(getCachedConnectionSettingsForWorkers()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'plain-token',
        fetchToken: '',
        tokenDisabled: false,
      });
    });

    test('caches the effective (empty) token, not the raw one, while silenced', async () => {
      await saveConnectionSettings({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'plain-token',
        tokenDisabled: true,
      });

      expect(getCachedConnectionSettingsForWorkers()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
        fetchToken: '',
        tokenDisabled: true,
      });
    });

    test('can be set directly, for a caller that already fetched settings itself', () => {
      const settings = { apiBaseUrl: DEFAULT_API_BASE_URL, token: 'x', fetchToken: '' };
      setCachedConnectionSettingsForWorkers(settings);
      expect(getCachedConnectionSettingsForWorkers()).toBe(settings);
    });
  });

  describe('testConnection', () => {
    test('fails fast when no token is provided, without calling fetch', async () => {
      const result = await testConnection({ apiBaseUrl: DEFAULT_API_BASE_URL, token: '' });

      expect(result.ok).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('reports the logged-in user on success', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ login: 'taljacob2' }) });

      const result = await testConnection({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'good-token',
      });

      expect(result).toEqual({ ok: true, message: 'Connected as taljacob2' });
      expect(global.fetch).toHaveBeenCalledWith(`${DEFAULT_API_BASE_URL}/user`, {
        headers: {
          Authorization: 'Bearer good-token',
          Accept: 'application/vnd.github+json',
        },
      });
    });

    test('surfaces the status code on a non-OK response', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });

      const result = await testConnection({ apiBaseUrl: DEFAULT_API_BASE_URL, token: 'bad-token' });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('401');
    });

    test('reports a network failure', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await testConnection({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'good-token',
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Failed to fetch');
    });

    test('surfaces an SSO authorization link instead of a generic 403 message', async () => {
      const ssoUrl = 'https://github.com/orgs/octo-org/sso?authorization_request=abc123';
      global.fetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: { get: (name) => (name === 'X-GitHub-SSO' ? `required; url=${ssoUrl}` : null) },
      });

      const result = await testConnection({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: 'valid-but-unauthorized-token',
      });

      expect(result.ok).toBe(false);
      expect(result.ssoUrl).toBe(ssoUrl);
      expect(result.message).not.toContain('403');
    });
  });

  describe('parseSsoAuthorizationUrl', () => {
    test('extracts the url= value from a "required" X-GitHub-SSO header', () => {
      const ssoUrl = 'https://github.com/orgs/octo-org/sso?authorization_request=abc123';
      const response = {
        headers: { get: (name) => (name === 'X-GitHub-SSO' ? `required; url=${ssoUrl}` : null) },
      };

      expect(parseSsoAuthorizationUrl(response)).toBe(ssoUrl);
    });

    test('returns null when the header is absent', () => {
      const response = { headers: { get: () => null } };
      expect(parseSsoAuthorizationUrl(response)).toBeNull();
    });

    test('returns null for a "partial-results" header with no url= (multi-org listing)', () => {
      const response = {
        headers: { get: () => 'partial-results; organizations=21955855,20582480' },
      };
      expect(parseSsoAuthorizationUrl(response)).toBeNull();
    });

    test('returns null when the response has no headers object at all', () => {
      expect(parseSsoAuthorizationUrl({})).toBeNull();
    });
  });

  describe('deriveWebBaseUrl', () => {
    test('strips the api. prefix for github.com', () => {
      expect(deriveWebBaseUrl('https://api.github.com')).toBe('https://github.com');
    });

    test('strips the api. prefix for a GHEC custom domain', () => {
      expect(deriveWebBaseUrl('https://api.mycompany.ghe.com')).toBe('https://mycompany.ghe.com');
    });

    test('returns null for an unparseable URL', () => {
      expect(deriveWebBaseUrl('not a url')).toBeNull();
    });
  });

  describe('buildTokenCreationUrl', () => {
    test('includes name, description, contents, and target_name when provided', () => {
      const url = buildTokenCreationUrl({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        contents: 'write',
        targetName: 'taljacob2',
        name: 'my token',
        description: 'my description',
      });

      expect(url).toBe(
        'https://github.com/settings/personal-access-tokens/new?' +
          'name=my+token&description=my+description&contents=write&target_name=taljacob2'
      );
    });

    test('omits target_name when not passed', () => {
      const url = buildTokenCreationUrl({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        contents: 'read',
        name: 'my token',
        description: 'my description',
      });

      expect(url).not.toContain('target_name');
    });

    test('returns null when the base URL cannot be parsed', () => {
      expect(
        buildTokenCreationUrl({
          apiBaseUrl: 'not a url',
          contents: 'read',
          name: 'n',
          description: 'd',
        })
      ).toBeNull();
    });
  });

  describe('buildClassicTokenCreationUrl', () => {
    test('links to the classic token page with the repo scope and a description', () => {
      const url = buildClassicTokenCreationUrl({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        description: 'my description',
      });

      expect(url).toBe(
        'https://github.com/settings/tokens/new?scopes=repo&description=my+description'
      );
    });

    test('points at a GHEC custom domain’s own token page', () => {
      const url = buildClassicTokenCreationUrl({
        apiBaseUrl: 'https://api.mycompany.ghe.com',
        description: 'my description',
      });

      expect(url).toBe(
        'https://mycompany.ghe.com/settings/tokens/new?scopes=repo&description=my+description'
      );
    });

    test('returns null when the base URL cannot be parsed', () => {
      expect(
        buildClassicTokenCreationUrl({ apiBaseUrl: 'not a url', description: 'd' })
      ).toBeNull();
    });
  });
});
