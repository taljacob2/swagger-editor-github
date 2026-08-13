const STORAGE_KEY = 'github-editor:connection';

export const DEFAULT_API_BASE_URL = 'https://api.github.com';

const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

export function getConnectionSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { apiBaseUrl: DEFAULT_API_BASE_URL, token: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      apiBaseUrl: parsed.apiBaseUrl || DEFAULT_API_BASE_URL,
      token: parsed.token || '',
    };
  } catch {
    return { apiBaseUrl: DEFAULT_API_BASE_URL, token: '' };
  }
}

export function saveConnectionSettings({ apiBaseUrl, token }) {
  const settings = {
    apiBaseUrl: stripTrailingSlashes(apiBaseUrl || DEFAULT_API_BASE_URL),
    token: token || '',
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

// GitHub's REST API sends permissive CORS headers and accepts a bearer token
// directly from browser JS, so this is a plain authenticated fetch — no proxy.
// See docs/Design.md "Why no backend is needed".
export async function testConnection({ apiBaseUrl, token }) {
  if (!token) {
    return { ok: false, message: 'Enter a personal access token first.' };
  }

  try {
    const response = await fetch(`${stripTrailingSlashes(apiBaseUrl)}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `GitHub API returned ${response.status} ${response.statusText}`,
      };
    }

    const user = await response.json();
    return { ok: true, message: `Connected as ${user.login}` };
  } catch (error) {
    return { ok: false, message: `Request failed: ${error.message}` };
  }
}
