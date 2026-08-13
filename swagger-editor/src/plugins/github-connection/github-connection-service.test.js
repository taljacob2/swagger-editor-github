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
    test('defaults to api.github.com with no token when nothing is stored', () => {
      expect(getConnectionSettings()).toEqual({ apiBaseUrl: DEFAULT_API_BASE_URL, token: '' });
    });

    test('falls back to defaults when localStorage holds invalid JSON', () => {
      localStorage.setItem('github-editor:connection', 'not json');
      expect(getConnectionSettings()).toEqual({ apiBaseUrl: DEFAULT_API_BASE_URL, token: '' });
    });
  });

  describe('saveConnectionSettings', () => {
    test('round-trips through localStorage and strips a trailing slash', () => {
      saveConnectionSettings({ apiBaseUrl: 'https://api.mycompany.ghe.com/', token: 'good-token' });

      expect(getConnectionSettings()).toEqual({
        apiBaseUrl: 'https://api.mycompany.ghe.com',
        token: 'good-token',
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
