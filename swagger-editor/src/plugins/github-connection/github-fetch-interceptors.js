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

import { getConnectionSettings } from './github-connection-service.js';
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
// never carry a base64 `content`/`encoding` envelope at this path shape, so
// it's safe to unwrap unconditionally whenever both are present.
export async function githubResponseInterceptor(response) {
  if (!isContentsApiPath(response.url) || response.obj?.encoding !== 'base64') {
    return response;
  }
  if (typeof response.obj.content !== 'string') {
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
