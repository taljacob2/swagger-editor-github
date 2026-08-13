import {
  DEFAULT_API_BASE_URL,
  getConnectionSettings,
  saveConnectionSettings,
  testConnection,
} from './github-connection-service.js';

describe('github-connection-service', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
  });

  describe('getConnectionSettings', () => {
    test('defaults to api.github.com with no token when nothing is stored', async () => {
      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
      });
    });

    test('falls back to defaults when localStorage holds invalid JSON', async () => {
      localStorage.setItem('github-editor:connection', 'not json');
      expect(await getConnectionSettings()).toEqual({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        token: '',
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
      });
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
      });
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
  });
});
