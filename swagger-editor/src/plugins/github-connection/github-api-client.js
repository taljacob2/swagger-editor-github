import { parseSsoAuthorizationUrl } from './github-connection-service.js';

const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

// Shared authenticated-fetch helper against the GitHub REST API -- originally
// lived only in aggregation-storage-service.js, promoted here so
// github-repo-browser and the PR-suggestion flow can reuse the same
// fetch/error/SSO-handling logic instead of duplicating it a third time.
// eslint-disable-next-line import/prefer-default-export
export async function ghRequest(path, { connection, method = 'GET', body, allow404 = false } = {}) {
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
    // GitHub's own error bodies are JSON ({"message": "...", "documentation_url": "..."}) --
    // surfacing that raw (braces, quotes, doc link and all) in the UI reads
    // as a wall of noise. Pull out just the human sentence when it parses;
    // fall back to the raw body only when it's not the shape expected (an
    // HTML error page from some intermediary, for instance).
    let cleanDetail = detail;
    try {
      cleanDetail = JSON.parse(detail).message || detail;
    } catch {
      // not JSON -- use detail as-is
    }
    const ssoUrl = parseSsoAuthorizationUrl(response);
    // A read-then-write-with-sha caller (e.g. saveAggregationSet) gets a 409
    // from GitHub when the file changed since it was last read (a real
    // conflict, not a bug) -- worth a specific, actionable message instead of
    // the generic one below, which just reads as an opaque API error.
    const isSaveConflict = response.status === 409;
    const error = new Error(
      ssoUrl
        ? "This token is valid, but hasn't been authorized for single sign-on on this organization."
        : isSaveConflict
          ? 'This was updated elsewhere since you loaded it. Reload it and reapply your changes before saving again.'
          : `GitHub API ${method} ${path} failed (${response.status}): ${cleanDetail || response.statusText}`
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
