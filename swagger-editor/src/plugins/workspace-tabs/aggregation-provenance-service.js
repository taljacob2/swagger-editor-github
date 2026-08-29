const PROVENANCE_STORAGE_KEY_PREFIX = 'workspace-tabs:aggregation-provenance:';

function provenanceStorageKey(tabId) {
  return `${PROVENANCE_STORAGE_KEY_PREFIX}${tabId}`;
}

// Same own-key-per-tab pattern as linked-target-service.js, established the
// moment a set is aggregated into a tab (see AggregateMenuHandler.jsx's
// handleAggregateClick) and read back by SuggestAggregatedPrsModal to trace
// an edit made in the merged view back to the source file(s) it came from.
//
// {
//   setId,                // absent on a record saved before this field existed
//   setName,
//   sources: [{ name, url, apiBaseUrl, owner, repo, path, ref, baselineContent }],
//   provenance,           // mergeSpecs's own provenance map, from aggregateSet
//   baselineMergedText,   // the merged YAML text as it stood right after aggregating
// }
export function getAggregationProvenance(tabId) {
  try {
    const raw = localStorage.getItem(provenanceStorageKey(tabId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAggregationProvenance(tabId, record) {
  localStorage.setItem(provenanceStorageKey(tabId), JSON.stringify(record));
}

export function removeAggregationProvenance(tabId) {
  localStorage.removeItem(provenanceStorageKey(tabId));
}
