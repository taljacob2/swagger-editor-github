import { ghRequest } from '../github-connection/github-api-client.js';
import { deriveWebBaseUrl } from '../github-connection/github-connection-service.js';
import { base64ToUtf8 } from '../aggregation-storage/aggregation-storage-service.js';

const PER_PAGE = 100;

// A basename-only match, deliberately broader than
// aggregation-storage-service.js's SPEC_FILE_EXTENSION_RE (which only checks
// the extension, for validating a manually-typed URL) -- here we're
// filtering thousands of tree entries down to plausible spec files, so the
// filename itself is worth checking too.
const SPEC_FILENAME_RE = /^(swagger|openapi)\.(ya?ml|json)$/i;

// GitHub's list endpoints don't expose a total count without parsing the
// Link header (which ghRequest doesn't surface), so pages are fetched until
// one comes back short of a full page -- the standard "did I get everything"
// signal for offset-style pagination.
async function fetchAllPages(pathBuilder, connection) {
  const results = [];
  let page = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- each page depends on the last
    const items = await ghRequest(pathBuilder(page), { connection });
    results.push(...items);
    if (items.length < PER_PAGE) {
      return results;
    }
    page += 1;
  }
}

export async function listRepos(connection) {
  return fetchAllPages(
    (page) => `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=full_name&direction=asc`,
    connection
  );
}

export async function listBranches(owner, repo, connection) {
  return fetchAllPages(
    (page) => `/repos/${owner}/${repo}/branches?per_page=${PER_PAGE}&page=${page}`,
    connection
  );
}

// Deterministic tree walk, not GitHub's code search API -- code search has a
// much stricter rate limit, can lag on recently-pushed content, and isn't
// guaranteed available identically across every GHEC org. This uses only the
// Git Data API the app already depends on elsewhere.
export async function listSpecFiles(owner, repo, ref, connection) {
  const tree = await ghRequest(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { connection }
  );
  return tree.tree
    .filter((entry) => entry.type === 'blob' && SPEC_FILENAME_RE.test(entry.path.split('/').pop()))
    .map((entry) => ({ path: entry.path, ref }));
}

export async function getFileContent(owner, repo, path, ref, connection) {
  const file = await ghRequest(
    `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { connection }
  );
  return { content: base64ToUtf8(file.content), sha: file.sha };
}

// Builds the same .../blob/{ref}/{path} shape parseGitHubFileUrl already
// recognizes, so a repo-browser selection round-trips through the existing
// aggregation fetch/merge path (aggregation-merge-service.js) unchanged.
export function buildBlobUrl({ owner, repo, path, ref, apiBaseUrl }) {
  const webBaseUrl = deriveWebBaseUrl(apiBaseUrl);
  return `${webBaseUrl}/${owner}/${repo}/blob/${ref}/${path}`;
}

// Exact casing/format is a UI-polish detail -- the one behavioral
// requirement is "prefilled, not blank, remains editable", which the repo
// name alone already satisfies.
export function defaultNameFrom(repo) {
  return repo;
}
