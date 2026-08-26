import { Buffer } from 'buffer';
import { Resolver, options as apidomReferenceOptions } from '@swagger-api/apidom-reference';

import parseGitHubFileUrl from '../../github-connection/github-file-url.js';
import {
  base64ToUtf8,
  stripTrailingSlashes,
} from '../../aggregation-storage/aggregation-storage-service.js';

// Same rewrite as aggregation-merge-service.js's fetchSpec, but plugged into
// apidom-reference's own resolver chain instead -- this is what live
// validation/hover/go-to-definition/"Resolve document" use to fetch a $ref
// that points at another file, and none of that goes through fetchSpec.
// Without this, a private repo's raw/blob $ref hits the same CORS wall
// fetchSpec was built to route around, just from a different call site.
class GitHubResolver extends Resolver {
  constructor({ apiBaseUrl, token } = {}) {
    super({ name: 'github-resolver' });
    this.apiBaseUrl = apiBaseUrl;
    this.token = token;
  }

  canRead(file) {
    return parseGitHubFileUrl(file.uri, this.apiBaseUrl) !== null;
  }

  async read(file) {
    const parsed = parseGitHubFileUrl(file.uri, this.apiBaseUrl);
    const requestUrl = `${stripTrailingSlashes(parsed.apiBase)}/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}?ref=${encodeURIComponent(parsed.ref)}`;
    const headers = { Accept: 'application/vnd.github+json' };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(requestUrl, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} (${requestUrl})`);
    }

    const contentsFile = await response.json();
    return Buffer.from(base64ToUtf8(contentsFile.content), 'utf-8');
  }
}

export default GitHubResolver;

// Prepended ahead of apidom-reference's own default resolvers (file, plain
// HTTP) so GitHub-shaped URLs are claimed by this one first; anything else
// (a public third-party $ref, a local file) still falls through to the
// defaults exactly as before. apiBaseUrl is always set (falls back to
// https://api.github.com), so this resolver is always active -- with no
// token it still routes public-repo $refs through the Contents API instead
// of the raw host, which works fine unauthenticated and isn't a regression.
export function buildResolvers({ apiBaseUrl, token } = {}) {
  return [new GitHubResolver({ apiBaseUrl, token }), ...apidomReferenceOptions.resolve.resolvers];
}
