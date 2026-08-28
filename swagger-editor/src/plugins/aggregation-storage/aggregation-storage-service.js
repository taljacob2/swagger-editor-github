import { parseSsoAuthorizationUrl } from '../github-connection/github-connection-service.js';

const STORAGE_KEY = 'github-editor:aggregation-storage';
const SETS_DIR = 'aggregation-sets';

// The storage branch is always "aggregation-data-<something>" -- the fixed
// prefix keeps it visually distinct from a repo's real branches (so it's
// obvious at a glance it's app-managed data, not content), while the
// editable suffix after it lets colleagues share a specific data branch
// (e.g. "aggregation-data-team-x") instead of everyone colliding on one.
export const BRANCH_PREFIX = 'aggregation-data-';
const DEFAULT_BRANCH_SUFFIX = 'default';
export const DEFAULT_BRANCH = `${BRANCH_PREFIX}${DEFAULT_BRANCH_SUFFIX}`;

// The part of a stored branch name after the fixed prefix, for editing in
// the Branch field's suffix input. Falls back to the whole value when it
// doesn't have the prefix (e.g. a branch saved before this field existed).
export function branchSuffixFromBranch(branch) {
  if (branch && branch.startsWith(BRANCH_PREFIX)) {
    return branch.slice(BRANCH_PREFIX.length);
  }
  return branch || '';
}

// Reattaches the fixed prefix to a user-typed suffix, defaulting to
// DEFAULT_BRANCH_SUFFIX when empty.
export function buildBranchName(suffix) {
  const trimmed = (suffix || '').trim();
  return `${BRANCH_PREFIX}${trimmed || DEFAULT_BRANCH_SUFFIX}`;
}

export const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

// UTF-8 safe base64 helpers — the Contents API round-trips base64 bytes, and
// plain btoa()/atob() only handle Latin1, which mangles non-ASCII spec content.
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToUtf8(base64) {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// GitHub Pages project sites are served at https://<owner>.github.io/<repo>/,
// so on a deployed site the storage target can default to "this repo" with
// zero configuration. Elsewhere (local dev, a custom domain) it's blank until
// the user sets it explicitly.
//
// This hostname/path parsing only covers github.com-style Pages. A privately
// published Pages site on GitHub Enterprise Cloud is served from a subdomain
// shaped like <owner>-<repo>.pages.<hostname> instead (see the base-path
// comment in .github/workflows/deploy-pages.yml) — owner and repo are folded
// into one hyphenated label with no reliable place to split it back apart
// (both halves can contain hyphens themselves), so it can't be parsed here.
function detectDefaultOwnerRepoFromHostname() {
  const hostMatch = window.location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!hostMatch) {
    return { owner: '', repo: '' };
  }
  const [, owner] = hostMatch;
  const [repo = ''] = window.location.pathname.split('/').filter(Boolean);
  return { owner, repo };
}

// For deployments where hostname parsing doesn't apply (GHEC's
// <owner>-<repo>.pages.<hostname> subdomain shape, or any other Pages URL
// this app doesn't recognize), .github/workflows/deploy-pages.yml bakes the
// repo's actual owner/name in at build time via VITE_GITHUB_STORAGE_OWNER /
// VITE_GITHUB_STORAGE_REPO -- values GitHub Actions already knows exactly,
// with nothing for whoever deploys to configure by hand (unlike
// VITE_GITHUB_API_BASE_URL, which needs a real choice: a GHEC deployment's
// API host isn't derivable from repository metadata). Takes priority over
// hostname parsing since it's unambiguous wherever it's present.
function detectDefaultOwnerRepo() {
  const owner = import.meta.env.VITE_GITHUB_STORAGE_OWNER;
  const repo = import.meta.env.VITE_GITHUB_STORAGE_REPO;
  if (owner && repo) {
    return { owner, repo };
  }
  return detectDefaultOwnerRepoFromHostname();
}

export function getStorageSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.owner && parsed.repo) {
        return {
          owner: parsed.owner,
          repo: parsed.repo,
          branch: parsed.branch || DEFAULT_BRANCH,
        };
      }
    }
  } catch {
    // fall through to defaults
  }
  return { ...detectDefaultOwnerRepo(), branch: DEFAULT_BRANCH };
}

export function saveStorageSettings({ owner, repo, branch }) {
  const settings = {
    owner: (owner || '').trim(),
    repo: (repo || '').trim(),
    branch: buildBranchName(branchSuffixFromBranch(branch)),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

// Order is functionally meaningful, not just cosmetic: mergeSpecs iterates
// swaggerUrls in array order, so for non-colliding paths/tags/components,
// whichever service is first here ends up first in the merged output. Same
// no-op-at-the-edge contract as workspace-tabs-service.js's reorderTab —
// returns the same array reference when there's nothing to move.
export function moveSwaggerUrl(swaggerUrls, index, direction) {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= swaggerUrls.length) {
    return swaggerUrls;
  }
  const next = [...swaggerUrls];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

// A live hint while typing/pasting a swagger URL, not a hard validation --
// this repo has already seen a URL get pasted with its tail cut off
// somewhere upstream (an address bar or link label that visually elides
// long text, copied instead of using "copy link address"), which surfaces
// much later and far more confusingly as a CORS error or a 404 on a
// mangled Contents API path. Anything not ending in a recognized spec-file
// extension is flagged -- a truncated URL falls out of this check for free
// (it just happens to have no extension at its cut-off point), without
// needing a separate "does this look cut off" heuristic of its own.
const SPEC_FILE_EXTENSION_RE = /\.(ya?ml|json)$/i;

export function getSwaggerUrlWarning(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  let pathname;
  try {
    ({ pathname } = new URL(trimmed));
  } catch {
    return "Doesn't look like a valid URL.";
  }
  if (!SPEC_FILE_EXTENSION_RE.test(pathname)) {
    return "Doesn't look like it points to a spec file (expected it to end in .yaml, .yml, or .json) — if you pasted this, double-check it wasn't cut off.";
  }
  return null;
}

async function ghRequest(path, { connection, method = 'GET', body, allow404 = false } = {}) {
  // Omit Authorization entirely when there's no token, rather than sending an
  // empty bearer value — GitHub treats a malformed token as bad credentials
  // (401) even for reading a public repo, which would otherwise need no auth
  // at all. This is what lets saved sets show up for visitors who haven't
  // set up a PAT yet, as long as the storage repo is public.
  const response = await fetch(`${stripTrailingSlashes(connection.apiBaseUrl)}${path}`, {
    method,
    headers: {
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      Accept: 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 404 && allow404) {
    return null;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const ssoUrl = parseSsoAuthorizationUrl(response);
    // saveAggregationSet's read-then-write-with-sha check makes GitHub return
    // 409 when the file changed since it was last read (a real conflict, not
    // a bug) -- worth a specific, actionable message instead of the generic
    // one below, which just reads as an opaque API error.
    const isSaveConflict = response.status === 409;
    const error = new Error(
      ssoUrl
        ? "This token is valid, but hasn't been authorized for single sign-on on this organization."
        : isSaveConflict
          ? 'This set was updated elsewhere since you loaded it. Reload it and reapply your changes before saving again.'
          : `GitHub API ${method} ${path} failed: ${response.status} ${response.statusText} ${detail}`
    );
    // Attached so callers can tell "no permission" apart from other failures
    // without string-matching the message.
    error.status = response.status;
    error.ssoUrl = ssoUrl;
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

// Creates the storage branch as an orphan (no shared history with the site's
// own branch) if it doesn't exist yet. Idempotent — safe to call before every
// write. See docs/Design.md's "Aggregation-set storage" section.
export async function ensureDataBranch(storage, connection) {
  const { owner, repo, branch } = storage;
  const existingRef = await ghRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    connection,
    allow404: true,
  });
  if (existingRef) {
    return;
  }

  const readme = `# Aggregation data\n\nJSON storage for this Swagger Editor's aggregation sets, managed via the GitHub API. Not meant to be merged into another branch — see docs/Design.md.\n`;
  const blob = await ghRequest(`/repos/${owner}/${repo}/git/blobs`, {
    connection,
    method: 'POST',
    body: { content: utf8ToBase64(readme), encoding: 'base64' },
  });
  const tree = await ghRequest(`/repos/${owner}/${repo}/git/trees`, {
    connection,
    method: 'POST',
    body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] },
  });
  const commit = await ghRequest(`/repos/${owner}/${repo}/git/commits`, {
    connection,
    method: 'POST',
    body: { message: 'Initialize aggregation data branch', tree: tree.sha, parents: [] },
  });
  await ghRequest(`/repos/${owner}/${repo}/git/refs`, {
    connection,
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: commit.sha },
  });
}

// Whether the storage branch already exists on the repo -- used to tell the
// user upfront whether this location has existing aggregation data or is
// brand new (and will be created automatically on the first set save, see
// ensureDataBranch above).
export async function doesBranchExist(storage, connection) {
  const { owner, repo, branch } = storage;
  try {
    const ref = await ghRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      connection,
      allow404: true,
    });
    return Boolean(ref);
  } catch {
    return false;
  }
}

// Whether the current connection's token has push (write) access to the
// storage repo — used to decide whether to show set-editing controls at all,
// rather than letting someone hit a 403 on save. GitHub only includes the
// `permissions` object for authenticated requests, so an anonymous request
// (no token) correctly resolves to false with no special-casing needed.
export async function canWriteToStorage(storage, connection) {
  const { owner, repo } = storage;
  try {
    const repoInfo = await ghRequest(`/repos/${owner}/${repo}`, { connection, allow404: true });
    return Boolean(repoInfo?.permissions?.push);
  } catch {
    return false;
  }
}

// The storage repo's actual default branch (e.g. "main") -- used to block
// the Branch field from being set to it, since every write here (set saves,
// deletes, ensureDataBranch) commits straight to whatever branch is
// configured. Returns null (no comparison possible) if the check itself
// fails, so a transient API hiccup doesn't block legitimate saves.
export async function getRepoDefaultBranch(storage, connection) {
  const { owner, repo } = storage;
  try {
    const repoInfo = await ghRequest(`/repos/${owner}/${repo}`, { connection, allow404: true });
    return repoInfo?.default_branch || null;
  } catch {
    return null;
  }
}

export async function getAggregationSet(id, storage, connection) {
  const { owner, repo, branch } = storage;
  const file = await ghRequest(
    `/repos/${owner}/${repo}/contents/${SETS_DIR}/${encodeURIComponent(id)}.json?ref=${encodeURIComponent(branch)}`,
    { connection, allow404: true }
  );
  if (!file) {
    return null;
  }
  const data = JSON.parse(base64ToUtf8(file.content));
  return { ...data, id, sha: file.sha };
}

export async function listAggregationSets(storage, connection) {
  const { owner, repo, branch } = storage;
  const entries = await ghRequest(
    `/repos/${owner}/${repo}/contents/${SETS_DIR}?ref=${encodeURIComponent(branch)}`,
    { connection, allow404: true }
  );
  if (!entries) {
    return [];
  }

  const jsonEntries = entries.filter(
    (entry) => entry.type === 'file' && entry.name.endsWith('.json')
  );
  const sets = await Promise.all(
    jsonEntries.map((entry) =>
      getAggregationSet(entry.name.replace(/\.json$/, ''), storage, connection)
    )
  );
  return sets.filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function saveAggregationSet(input, storage, connection) {
  await ensureDataBranch(storage, connection);
  const { owner, repo, branch } = storage;
  const id = input.id || generateId();
  const existing = await getAggregationSet(id, storage, connection);
  const now = new Date().toISOString();

  const record = {
    name: input.name,
    swaggerUrls: input.swaggerUrls || [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const result = await ghRequest(`/repos/${owner}/${repo}/contents/${SETS_DIR}/${id}.json`, {
    connection,
    method: 'PUT',
    body: {
      message: existing
        ? `Update aggregation set "${record.name}"`
        : `Create aggregation set "${record.name}"`,
      content: utf8ToBase64(JSON.stringify(record, null, 2)),
      branch,
      ...(existing ? { sha: existing.sha } : {}),
    },
  });

  return { ...record, id, sha: result.content.sha };
}

export async function deleteAggregationSet(id, storage, connection) {
  const existing = await getAggregationSet(id, storage, connection);
  if (!existing) {
    return;
  }
  const { owner, repo, branch } = storage;
  await ghRequest(`/repos/${owner}/${repo}/contents/${SETS_DIR}/${id}.json`, {
    connection,
    method: 'DELETE',
    body: { message: `Delete aggregation set "${existing.name}"`, sha: existing.sha, branch },
  });
}
