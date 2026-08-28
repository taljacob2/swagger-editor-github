import { ghRequest } from '../github-connection/github-api-client.js';

const BRANCH_PREFIX = 'swagger-editor-suggestion-';

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
