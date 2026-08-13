const STORAGE_KEY = 'github-editor:connection';
const ENCRYPTION_KEY_STORAGE_KEY = 'github-editor:token-key';

export const DEFAULT_API_BASE_URL = 'https://api.github.com';

const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

// The API host can't be reliably auto-detected from the deployed Pages
// hostname — a GHEC org's custom domain doesn't map deterministically to its
// API host. Instead, whoever deploys for a specific GHEC org can bake the
// right default in at build time via VITE_GITHUB_API_BASE_URL (e.g. a repo
// variable read by .github/workflows/deploy-pages.yml), so visitors to that
// deployment get the correct default with nothing to type in. Falls back to
// plain github.com when unset, which needs no configuration at all.
function resolveDefaultApiBaseUrl() {
  const configured = import.meta.env.VITE_GITHUB_API_BASE_URL;
  return configured ? stripTrailingSlashes(configured) : DEFAULT_API_BASE_URL;
}

// Encrypts the PAT at rest in localStorage with a browser-generated AES-GCM
// key (also in localStorage). Ported from swagger-editor-gitlab's
// TokenCrypto (docs/RememberToken.md there). Worth being honest about what
// this actually buys: since the key lives alongside the ciphertext, it does
// NOT protect against an attacker with full access to the browser/device —
// it just means the token isn't sitting in localStorage as readable plain
// text for casual inspection (a lazy extension dump, a screen-share, etc.).
async function generateEncryptionKey() {
  const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const exported = await window.crypto.subtle.exportKey('jwk', key);
  localStorage.setItem(ENCRYPTION_KEY_STORAGE_KEY, JSON.stringify(exported));
  return key;
}

async function getEncryptionKey() {
  const stored = localStorage.getItem(ENCRYPTION_KEY_STORAGE_KEY);
  if (!stored) {
    return generateEncryptionKey();
  }
  try {
    const keyData = JSON.parse(stored);
    return await window.crypto.subtle.importKey('jwk', keyData, { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ]);
  } catch {
    return generateEncryptionKey();
  }
}

async function encryptToken(token) {
  if (!token) {
    return '';
  }
  try {
    const key = await getEncryptionKey();
    const data = new TextEncoder().encode(token);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    let binary = '';
    combined.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  } catch {
    return token; // fall back to plain text rather than losing the value
  }
}

// Encrypted tokens are base64 and much longer than a raw PAT — used to tell
// an encrypted value apart from a plain-text one (e.g. left over from before
// this was added), so existing unencrypted tokens keep working.
function looksEncrypted(value) {
  if (value.length < 40) {
    return false;
  }
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}

async function decryptToken(value) {
  if (!value) {
    return '';
  }
  if (!looksEncrypted(value)) {
    return value;
  }
  try {
    const key = await getEncryptionKey();
    const binary = atob(value);
    const combined = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch {
    return value; // fall back to treating it as plain text
  }
}

export async function getConnectionSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { apiBaseUrl: resolveDefaultApiBaseUrl(), token: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      apiBaseUrl: parsed.apiBaseUrl || resolveDefaultApiBaseUrl(),
      token: await decryptToken(parsed.token || ''),
    };
  } catch {
    return { apiBaseUrl: resolveDefaultApiBaseUrl(), token: '' };
  }
}

export async function saveConnectionSettings({ apiBaseUrl, token }) {
  const settings = {
    apiBaseUrl: stripTrailingSlashes(apiBaseUrl || resolveDefaultApiBaseUrl()),
    token: token || '',
  };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...settings, token: await encryptToken(settings.token) })
  );
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
