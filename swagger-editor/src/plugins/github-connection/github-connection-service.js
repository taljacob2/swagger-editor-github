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

// Marks a value as this module's own encrypted format, rather than inferring
// it from shape (base64-decodability, minimum length) -- a real GitHub PAT
// could plausibly satisfy those heuristics by coincidence. Absence of the
// prefix means plain text, which covers both a legacy pre-encryption token
// and a token that fell back to plain text because encryptToken below
// failed -- both cases should be read back as-is, not run through decrypt.
const ENCRYPTED_PREFIX = 'enc:v1:';

// Encrypts the PAT and returns { value, encrypted } rather than a bare
// string, so callers (saveConnectionSettings) can tell a plain-text *value*
// (still the correct thing to store) apart from a plain-text *fallback*
// (encryption itself failed) and warn the user about the latter.
async function encryptToken(token) {
  if (!token) {
    return { value: '', encrypted: true };
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
    return { value: ENCRYPTED_PREFIX + btoa(binary), encrypted: true };
  } catch (error) {
    // Keep the token usable rather than losing it, but make the failure
    // observable -- silently persisting a PAT as plain text is worth a warning.
    // eslint-disable-next-line no-console
    console.warn('Failed to encrypt token; storing it unencrypted in localStorage.', error);
    return { value: token, encrypted: false };
  }
}

function looksEncrypted(value) {
  return value.startsWith(ENCRYPTED_PREFIX);
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
    const binary = atob(value.slice(ENCRYPTED_PREFIX.length));
    const combined = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch {
    // Fall back to treating it as plain text, stripping the marker so it
    // doesn't leak into the "plain text" value callers then use as a token.
    return value.slice(ENCRYPTED_PREFIX.length);
  }
}

// A cheap, synchronous, in-memory cache of the last-known connection
// settings, separate from getConnectionSettings() below (which always
// re-reads and re-decrypts from localStorage on every call, and stays that
// way -- callers like Connection Settings' own modal rely on always getting
// the current on-disk value). This cache exists purely so the ApiDOM worker
// can be handed fresh credentials on every validation/hover/etc. pass
// (apidom-mode.js) without paying a decrypt on every keystroke: it's
// populated for free by saveConnectionSettings below, and lazily by
// whichever worker call is first to ask, via getConnectionSettings.
let cachedConnectionSettingsForWorkers = null;

export function getCachedConnectionSettingsForWorkers() {
  return cachedConnectionSettingsForWorkers;
}

export function setCachedConnectionSettingsForWorkers(settings) {
  cachedConnectionSettingsForWorkers = settings;
}

export async function getConnectionSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { apiBaseUrl: resolveDefaultApiBaseUrl(), token: '', fetchToken: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      apiBaseUrl: parsed.apiBaseUrl || resolveDefaultApiBaseUrl(),
      token: await decryptToken(parsed.token || ''),
      fetchToken: await decryptToken(parsed.fetchToken || ''),
    };
  } catch {
    return { apiBaseUrl: resolveDefaultApiBaseUrl(), token: '', fetchToken: '' };
  }
}

export async function saveConnectionSettings({ apiBaseUrl, token, fetchToken }) {
  const settings = {
    apiBaseUrl: stripTrailingSlashes(apiBaseUrl || resolveDefaultApiBaseUrl()),
    token: token || '',
    fetchToken: fetchToken || '',
  };
  const encryptedToken = await encryptToken(settings.token);
  const encryptedFetchToken = await encryptToken(settings.fetchToken);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      token: encryptedToken.value,
      fetchToken: encryptedFetchToken.value,
    })
  );
  setCachedConnectionSettingsForWorkers(settings);
  // tokenEncrypted/fetchTokenEncrypted let callers (GitHubMenuHandler) warn
  // the user when encryption itself failed and the token was stored as
  // plain text -- true for an empty token, since there's nothing to warn about.
  return {
    ...settings,
    tokenEncrypted: encryptedToken.encrypted,
    fetchTokenEncrypted: encryptedFetchToken.encrypted,
  };
}

// GitHub's web host is the API host with a leading "api." stripped, matching
// this file's own apiBaseUrl convention (api.github.com -> github.com,
// api.<domain> -> <domain>). Returns null on anything unparseable so callers
// can hide a quick-link rather than guess at a broken one.
export function deriveWebBaseUrl(apiBaseUrl) {
  try {
    const url = new URL(apiBaseUrl);
    return `${url.protocol}//${url.host.replace(/^api\./, '')}`;
  } catch {
    return null;
  }
}

// Builds a link to GitHub's fine-grained PAT creation page, pre-filled via
// its documented query parameters (name/description/target_name/<permission>)
// -- https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
// There's no parameter to pre-select specific repositories, so "Only select
// repositories" is still a manual step; this just removes the rest of it.
//
// NOT currently wired into the Connection Settings UI -- kept for a possible
// future return to fine-grained tokens (still covered by its own tests
// below/in github-connection-service.test.js). A fine-grained PAT's
// "Resource owner" is chosen at creation time and is a separate axis from
// "Repository access": picking your personal account there means "All
// repositories" only ever covers your own repos, never an organization's,
// even if you're that org's owner -- and there's no in-app way to detect or
// warn about the mismatch, since the token still authenticates fine and
// simply 404s (indistinguishable from "repo doesn't exist") on every org
// repo it can't see. That's confusing enough in practice that
// docs/Permissions.md now recommends a classic PAT instead -- see
// buildClassicTokenCreationUrl below and docs/GitHubAuthentication.md.
export function buildTokenCreationUrl({ apiBaseUrl, contents, targetName, name, description }) {
  const webBaseUrl = deriveWebBaseUrl(apiBaseUrl);
  if (!webBaseUrl) {
    return null;
  }
  const params = new URLSearchParams({ name, description, contents });
  if (targetName) {
    params.set('target_name', targetName);
  }
  return `${webBaseUrl}/settings/personal-access-tokens/new?${params.toString()}`;
}

// Builds a link to GitHub's classic PAT creation page, pre-filled with the
// `repo` scope via its own (much smaller) query-parameter convention --
// classic tokens don't have fine-grained's per-repository or read/write
// pre-fill options, because a classic token's `repo` scope is inherently
// all-or-nothing (every repo the user can access, full read+write) -- there's
// nothing narrower to pre-select. See the resource-owner note above for why
// this is what Connection Settings actually links to right now.
export function buildClassicTokenCreationUrl({ apiBaseUrl, description }) {
  const webBaseUrl = deriveWebBaseUrl(apiBaseUrl);
  if (!webBaseUrl) {
    return null;
  }
  const params = new URLSearchParams({ scopes: 'repo', description });
  return `${webBaseUrl}/settings/tokens/new?${params.toString()}`;
}

// On a 403 from an org that enforces SAML/SSO, GitHub sends this header
// pointing at a one-click "authorize this token" page -- the token itself is
// valid, it just hasn't been cleared for that specific org yet. Without this,
// the app has no way to tell that failure apart from "wrong/expired token" or
// "no access at all", both of which need a different token instead.
// https://docs.github.com/en/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on
export function parseSsoAuthorizationUrl(response) {
  const header = response.headers?.get?.('X-GitHub-SSO');
  if (!header) {
    return null;
  }
  const match = header.match(/url=(\S+)/);
  return match ? match[1] : null;
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
      const ssoUrl = parseSsoAuthorizationUrl(response);
      if (ssoUrl) {
        return {
          ok: false,
          message:
            "This token is valid, but hasn't been authorized for an organization that requires single sign-on.",
          ssoUrl,
        };
      }
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
