// Shared by anything that needs to turn a GitHub raw/blob file URL into an
// authenticated Contents API request instead of fetching it as-is --
// aggregation-merge-service.js (an aggregation set's own URL list) and
// GitHubResolver (a $ref inside a spec, resolved by apidom-reference) both
// need the exact same recognition/rewrite logic, so it lives here once
// rather than risking the two drifting apart.

const GITHUB_COM_API_BASE_URL = 'https://api.github.com';
const GITHUB_COM_RAW_HOST = 'raw.githubusercontent.com';
const GITHUB_COM_WEB_HOST = 'github.com';

// GitHub now generates raw/blob links using this explicit `refs/heads/<name>`
// (or `refs/tags/<name>`) form by default, rather than the older bare
// `<branch>/<path>` shape -- disambiguates a branch/tag from the first path
// segment even when the name itself couldn't be confused with one. The
// `refs/(heads|tags)/` prefix is optional here so both URL shapes still
// match. This doesn't (and can't, from the URL text alone) handle a
// branch/tag name that itself contains a slash -- same best-effort caveat as
// the GHEC host derivation below.
const RAW_PATH_RE = /^\/([^/]+)\/([^/]+)\/(?:refs\/(?:heads|tags)\/)?([^/]+)\/(.+)$/;
const BLOB_PATH_RE = /^\/([^/]+)\/([^/]+)\/blob\/(?:refs\/(?:heads|tags)\/)?([^/]+)\/(.+)$/;

// A GHEC/GHE.com custom domain's web/raw hosts aren't fixed strings the way
// github.com's are -- they're derived from whatever apiBaseUrl the user has
// configured: api.<domain> -> <domain> for the file-viewer (blob) host,
// raw.<domain> for the raw-content host, by analogy with how github.com
// itself splits api.github.com from github.com and raw.githubusercontent.com.
// The blob-URL pattern is high-confidence -- same product, same route, just
// a different domain. The raw-content pattern is a best-effort guess,
// unverified against a real GHEC/GHE.com org -- see docs/Design.md.
function webHostFromApiBaseUrl(apiBaseUrl) {
  try {
    const { hostname } = new URL(apiBaseUrl);
    return hostname.startsWith('api.') ? hostname.slice('api.'.length) : hostname;
  } catch {
    return null;
  }
}

// raw.githubusercontent.com does not support authenticated CORS requests at
// all -- any fetch to it carrying an Authorization header gets blocked at
// the preflight, for public *and* private repos alike, regardless of token
// validity (confirmed against the live service). So a raw/blob URL that
// belongs to a recognized GitHub web/raw host is rewritten into a Contents
// API call instead: same content, but served from a host that (like the
// rest of this app's GitHub access) does support authenticated CORS.
export default function parseGitHubFileUrl(url, apiBaseUrl) {
  let hostname;
  let pathname;
  try {
    ({ hostname, pathname } = new URL(url));
  } catch {
    return null;
  }

  const webHost = webHostFromApiBaseUrl(apiBaseUrl);
  const candidates = [
    { host: GITHUB_COM_RAW_HOST, apiBase: GITHUB_COM_API_BASE_URL, pattern: RAW_PATH_RE },
    { host: GITHUB_COM_WEB_HOST, apiBase: GITHUB_COM_API_BASE_URL, pattern: BLOB_PATH_RE },
    ...(webHost && webHost !== GITHUB_COM_WEB_HOST
      ? [
          { host: `raw.${webHost}`, apiBase: apiBaseUrl, pattern: RAW_PATH_RE },
          { host: webHost, apiBase: apiBaseUrl, pattern: BLOB_PATH_RE },
        ]
      : []),
  ];

  const candidate = candidates.find((c) => c.host === hostname);
  if (!candidate) {
    return null;
  }
  // Matched against pathname, not the raw url string -- a raw-file URL
  // copied from GitHub's own "view raw" link on a private repo carries a
  // short-lived `?token=...` query parameter (GitHub's own signed-URL
  // mechanism, unrelated to a PAT). Matching the full URL let a greedy
  // `(.+)$` swallow "?token=..." into what it thought was the file path,
  // producing a malformed, double-"?" Contents API request that 404s.
  // pathname never includes the query string (or a fragment), so this
  // rewrite works the same whether or not the pasted URL carries one.
  const match = pathname.match(candidate.pattern);
  if (!match) {
    return null;
  }
  const [, owner, repo, ref, path] = match;
  return { owner, repo, ref, path, apiBase: candidate.apiBase };
}

// The inverse of the above: reconstructs the blob URL a linked target came
// from (or would have come from), so a UI can show a human what it already
// has linked without making them decode {owner, repo, path, ref} themselves.
export function buildGitHubFileUrl({ apiBaseUrl, owner, repo, path, ref }) {
  const webHost = webHostFromApiBaseUrl(apiBaseUrl);
  if (!webHost) {
    return null;
  }
  return `https://${webHost}/${owner}/${repo}/blob/${ref}/${path}`;
}
