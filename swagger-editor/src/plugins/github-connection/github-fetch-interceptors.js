// SwaggerUI core's own `spec` plugin (swagger-client) resolves $refs for the
// live Preview pane -- a completely separate pipeline from the ApiDOM
// worker's GitHubResolver (editor-monaco-language-apidom/language/
// github-resolver.js), which only covers validation/hover/go-to-definition.
// swagger-client fetches raw/blob GitHub URLs directly and has no
// GitHub-awareness, so a $ref into a private repo 404s here the same way it
// used to everywhere else -- see docs/GitHubAuthentication.md.
//
// swagger-client threads requestInterceptor/responseInterceptor (its own
// config, unrelated to Monaco/ApiDOM) through every fetch it makes --
// spec resolution *and* "Try it out" operation execution alike -- so these
// are wired in once, in App.tsx, and are a no-op for anything that isn't a
// GitHub raw/blob URL (spec resolution) or a Contents API response (nothing
// a real API server would ever return).
import YAML from 'js-yaml';

import { DEFAULT_API_BASE_URL, getConnectionSettings } from './github-connection-service.js';
import parseGitHubFileUrl from './github-file-url.js';
import {
  base64ToUtf8,
  stripTrailingSlashes,
} from '../aggregation-storage/aggregation-storage-service.js';

function isContentsApiPath(url) {
  try {
    return /\/repos\/[^/]+\/[^/]+\/contents\//.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export async function githubRequestInterceptor(request) {
  const connection = await getConnectionSettings();
  const parsed = parseGitHubFileUrl(request.url, connection.apiBaseUrl);
  if (!parsed) {
    return request;
  }

  request.url = `${stripTrailingSlashes(parsed.apiBase)}/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}?ref=${encodeURIComponent(parsed.ref)}`;
  request.headers = { ...request.headers, Accept: 'application/vnd.github+json' };

  const token = connection.fetchToken || connection.token;
  if (token) {
    request.headers.Authorization = `Bearer ${token}`;
  }
  return request;
}

// Runs against every response, not just ones this interceptor rewrote --
// there's no reliable way to correlate a specific request with its response
// through swagger-client's interceptor hooks. Instead this recognizes the
// Contents API's own response shape directly: a real API response would
// never carry a base64 `content`/`encoding` envelope at this path shape.
// isContentsApiPath is the real guard here (an unrelated API would need the
// exact `/repos/:owner/:repo/contents/...` path shape to even reach the
// encoding/content check below), and the hostname check narrows it further
// so a same-path coincidence on a different host can't trigger it either --
// the encoding/content check past that point is just a final shape
// confirmation, not a fallback guard in its own right.
export async function githubResponseInterceptor(response) {
  if (!isContentsApiPath(response.url)) {
    return response;
  }
  // A Contents API request always lands on one of exactly two hosts --
  // github.com's fixed API host (parseGitHubFileUrl always routes plain
  // github.com/raw.githubusercontent.com URLs there, independent of
  // whatever apiBaseUrl is configured), or the user's own configured
  // apiBaseUrl (GHEC, or aggregation-storage-service.js's own requests).
  // Anything else can't be a response this interceptor is meant to unwrap.
  const connection = await getConnectionSettings();
  try {
    const responseHost = new URL(response.url).hostname;
    const validHosts = new Set([
      new URL(DEFAULT_API_BASE_URL).hostname,
      new URL(connection.apiBaseUrl).hostname,
    ]);
    if (!validHosts.has(responseHost)) {
      return response;
    }
  } catch {
    return response;
  }
  if (response.obj?.encoding !== 'base64' || typeof response.obj.content !== 'string') {
    return response;
  }

  const decoded = base64ToUtf8(response.obj.content);
  const parsed = YAML.load(decoded);
  response.text = decoded;
  response.data = decoded;
  response.body = parsed;
  response.obj = parsed;
  return response;
}
