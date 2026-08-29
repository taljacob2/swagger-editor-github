// Bridges aggregation-diff-service.js's entry-level diff ops (which only
// know "this merged entry changed") and source-patch-service.js's
// applySourcePatch (which only knows "set/delete this exact path in this
// exact document") -- resolving each op back to the source file it came
// from, via the AggregationProvenance record's own provenance map (see
// workspace-tabs/aggregation-provenance-service.js and
// aggregation-storage/aggregation-merge-service.js's mergeSpecs).

function provenanceLookup(provenance, entryType, finalKey) {
  if (entryType === 'paths') {
    return provenance.paths?.[finalKey];
  }
  if (entryType === 'tags') {
    return provenance.tags?.[finalKey];
  }
  return provenance.components?.[entryType]?.[finalKey];
}

// Splits a diff-service `resolved` list into per-source buckets, folding
// anything that can't be traced to a linked source into the same
// `{ entryType, finalKey, reason }` shape aggregation-diff-service's own
// `unresolved` entries use, so the modal can render one unified callout
// regardless of *why* a change is being left out. A missing provenance
// entry should not happen in practice (the diff and the provenance both
// come from the same tab record), but a source that parseGitHubFileUrl
// couldn't resolve at aggregation time (see AggregateMenuHandler.jsx) is a
// real, reachable case -- there's nowhere to open a pull request for it.
export function groupResolvedOpsBySource(record, resolved) {
  const bySource = new Map();
  const unresolved = [];

  resolved.forEach((op) => {
    const provEntry = provenanceLookup(record.provenance, op.entryType, op.finalKey);
    if (!provEntry) {
      unresolved.push({ entryType: op.entryType, finalKey: op.finalKey, reason: 'no-provenance' });
      return;
    }
    // A plain find() would silently return the *first* match if two
    // sources in this record happen to share a name -- a real, already-
    // reachable case for a set that was aggregated before mergeSpecs
    // started rejecting name collisions (see aggregation-merge-service.js).
    // An op whose source name is ambiguous is exactly as untraceable as
    // one with no match at all, so both land in `unresolved` rather than
    // guessing which of the two same-named sources it actually belongs to.
    const matchingSources = record.sources.filter(
      (candidate) => candidate.name === provEntry.service
    );
    if (matchingSources.length !== 1) {
      unresolved.push({
        entryType: op.entryType,
        finalKey: op.finalKey,
        reason: matchingSources.length === 0 ? 'source-not-linked' : 'source-name-ambiguous',
      });
      return;
    }
    const [source] = matchingSources;
    if (!source.owner || !source.repo || !source.path || !source.ref) {
      unresolved.push({
        entryType: op.entryType,
        finalKey: op.finalKey,
        reason: 'source-not-linked',
      });
      return;
    }
    if (!bySource.has(source.name)) {
      bySource.set(source.name, []);
    }
    bySource.get(source.name).push({ ...op, originalKey: provEntry.originalKey });
  });

  return { bySource, unresolved };
}

// Resolves one grouped op (see above) to the full path applySourcePatch
// needs, rooted at the source document itself. Paths and each components/*
// sub-collection are addressed by key in both the merged spec and the
// source file, so the path is mechanical; a spec's `tags` is a plain
// sequence in the source file, not a map, so "the tag named X" only
// resolves to a path by searching for it in the source's own current
// content. Returns null -- never a path -- when the entry can't be found
// there anymore, the same "changed since baseline" situation a per-source
// drift check is meant to catch before this is ever reached.
export function resolveSourceSubPath(op, parsedSourceContent) {
  if (op.entryType === 'paths') {
    return ['paths', op.originalKey, ...op.subPath];
  }
  if (op.entryType === 'tags') {
    const tags = parsedSourceContent.tags || [];
    const index = tags.findIndex((tag) => tag.name === op.originalKey);
    return index === -1 ? null : ['tags', index, ...op.subPath];
  }
  return ['components', op.entryType, op.originalKey, ...op.subPath];
}

// Builds the ops array source-patch-service.js's applySourcePatch expects
// for one source, from that source's grouped ops (see
// groupResolvedOpsBySource) and its own freshly-fetched, already-parsed
// content. Anything that fails to resolve a path (see resolveSourceSubPath)
// is reported back as unresolved rather than thrown away silently.
export function buildSourcePatchOps(ops, parsedSourceContent) {
  const patchOps = [];
  const unresolved = [];

  ops.forEach((op) => {
    const subPath = resolveSourceSubPath(op, parsedSourceContent);
    if (!subPath) {
      unresolved.push({
        entryType: op.entryType,
        finalKey: op.finalKey,
        reason: 'source-entry-missing',
      });
      return;
    }
    patchOps.push({ subPath, value: op.newValue, isDelete: op.newValue === undefined });
  });

  return { patchOps, unresolved };
}
