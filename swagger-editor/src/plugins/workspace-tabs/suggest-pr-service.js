import { ghRequest } from '../github-connection/github-api-client.js';

const BRANCH_PREFIX = 'swagger-editor-suggestion-';

// Above this, the O(n*m) LCS table below gets expensive in both time and
// memory for no real benefit -- nobody reviews a multi-thousand-line diff
// line by line in a modal anyway. Callers fall back to a coarse before/after
// line-count summary instead of a real diff past this size.
export const MAX_DIFFABLE_LINES = 4000;

// A real (if simple) line-level diff via the standard LCS dynamic-programming
// approach -- not just a summary -- so "preview before you open a PR" shows
// what will actually change, not just that something did. No existing diff
// library in this app to reuse (nothing else here renders one), and pulling
// one in for a single modal felt heavier than ~25 lines of a well-known
// algorithm.
export function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  if (n > MAX_DIFFABLE_LINES || m > MAX_DIFFABLE_LINES) {
    return null;
  }

  // dp[i][j] = length of the LCS of a[i..] and b[j..].
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      lines.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < m) {
    lines.push({ type: 'added', text: b[j] });
    j += 1;
  }
  return lines;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

// Kept visually distinct the same way aggregation-storage-service.js's
// BRANCH_PREFIX is, so a branch this feature created is obvious at a glance.
export function buildSuggestionBranchName() {
  return `${BRANCH_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Whether the connected token can push to the target repo -- checked before
// attempting the branch/commit/PR sequence below, so a no-access token fails
// fast with one clear message instead of partway through a multi-call
// sequence.
export async function canWriteToRepo(owner, repo, connection) {
  const repoInfo = await ghRequest(`/repos/${owner}/${repo}`, { connection, allow404: true });
  return Boolean(repoInfo?.permissions?.push);
}

// Same blob -> tree -> commit -> ref pattern aggregation-storage-service.js's
// ensureDataBranch already uses for the storage branch, generalized to a
// single-file commit against an arbitrary target repo/branch instead.
export async function createSuggestionBranch(
  { owner, repo, baseRef, path, content, branchName, commitMessage },
  connection
) {
  const baseRefData = await ghRequest(
    `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(baseRef)}`,
    { connection }
  );
  const baseCommitSha = baseRefData.object.sha;
  const baseCommit = await ghRequest(`/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, {
    connection,
  });
  const blob = await ghRequest(`/repos/${owner}/${repo}/git/blobs`, {
    connection,
    method: 'POST',
    body: { content: utf8ToBase64(content), encoding: 'base64' },
  });
  const tree = await ghRequest(`/repos/${owner}/${repo}/git/trees`, {
    connection,
    method: 'POST',
    body: {
      base_tree: baseCommit.tree.sha,
      tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
    },
  });
  const commit = await ghRequest(`/repos/${owner}/${repo}/git/commits`, {
    connection,
    method: 'POST',
    body: { message: commitMessage, tree: tree.sha, parents: [baseCommitSha] },
  });
  await ghRequest(`/repos/${owner}/${repo}/git/refs`, {
    connection,
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: commit.sha },
  });
}

export async function createPullRequest({ owner, repo, title, body, base, head }, connection) {
  const pr = await ghRequest(`/repos/${owner}/${repo}/pulls`, {
    connection,
    method: 'POST',
    body: { title, body, base, head },
  });
  return pr.html_url;
}
