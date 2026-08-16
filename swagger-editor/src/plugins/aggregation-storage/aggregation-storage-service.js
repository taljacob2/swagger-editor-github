const STORAGE_KEY = 'github-editor:aggregation-storage';
const SETS_DIR = 'aggregation-sets';

export const DEFAULT_BRANCH = 'aggregation-data';

const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

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
function detectDefaultOwnerRepo() {
  const hostMatch = window.location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!hostMatch) {
    return { owner: '', repo: '' };
  }
  const [, owner] = hostMatch;
  const [repo = ''] = window.location.pathname.split('/').filter(Boolean);
  return { owner, repo };
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
    branch: (branch || DEFAULT_BRANCH).trim() || DEFAULT_BRANCH,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
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
    const error = new Error(
      `GitHub API ${method} ${path} failed: ${response.status} ${response.statusText} ${detail}`
    );
    // Attached so callers can tell "no permission" apart from other failures
    // without string-matching the message.
    error.status = response.status;
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
