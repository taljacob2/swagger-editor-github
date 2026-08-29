const LINK_STORAGE_KEY_PREFIX = 'workspace-tabs:link:';

function linkStorageKey(tabId) {
  return `${LINK_STORAGE_KEY_PREFIX}${tabId}`;
}

// { apiBaseUrl, owner, repo, path, ref, baselineContent, baselineFetchedAt }
// baselineContent/baselineFetchedAt capture the exact file content and time
// fetched when the link was established (or last refreshed) -- the
// drift-comparison basis for Suggest PR, never a substitute for a
// fetch-fresh-at-PR-time fetch.
export function getLinkedTarget(tabId) {
  try {
    const raw = localStorage.getItem(linkStorageKey(tabId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setLinkedTarget(tabId, target) {
  localStorage.setItem(linkStorageKey(tabId), JSON.stringify(target));
}

export function removeLinkedTarget(tabId) {
  localStorage.removeItem(linkStorageKey(tabId));
}
