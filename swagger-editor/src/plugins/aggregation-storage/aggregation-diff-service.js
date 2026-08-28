import { COMPONENT_TYPES } from './aggregation-merge-service.js';

// A collision-resolved entry (a merged path, tag, or component) is
// confidently traceable back to a single source file only when it exists
// under the same final key in both snapshots -- an entry that only appears
// on one side is structurally indistinguishable from "renamed" vs.
// "added"/"removed" from a plain diff, and guessing wrong here would
// silently corrupt someone else's file. So this walker resolves in-place
// field edits only, and surfaces anything else as unresolved rather than
// attempting it. See the Phase 2 spec's "Scope decisions" for the reasoning.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every(
        (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key])
      )
    );
  }
  return false;
}

// Recurses through plain objects only -- an array is always compared (and,
// if different, reported) as one leaf rather than diffed element-by-element,
// per the v1 scope decision to keep this tractable. A primitive, a missing
// side (a field added/removed), or a type mismatch (object vs. not) all fall
// through to the same leaf case for the same reason: there's nothing more
// precise to recurse into.
function diffValue(oldValue, newValue, subPath, leaves) {
  if (deepEqual(oldValue, newValue)) {
    return;
  }
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    keys.forEach((key) => diffValue(oldValue[key], newValue[key], [...subPath, key], leaves));
    return;
  }
  leaves.push({ subPath, oldValue, newValue });
}

function diffEntries(entryType, baselineEntries, currentEntries, resolved, unresolved) {
  const baselineKeys = Object.keys(baselineEntries);
  const currentKeys = Object.keys(currentEntries);
  const currentKeySet = new Set(currentKeys);
  const baselineKeySet = new Set(baselineKeys);

  baselineKeys.forEach((finalKey) => {
    if (!currentKeySet.has(finalKey)) {
      unresolved.push({ entryType, finalKey, reason: 'entry-removed' });
      return;
    }
    const leaves = [];
    diffValue(baselineEntries[finalKey], currentEntries[finalKey], [], leaves);
    leaves.forEach((leaf) => resolved.push({ entryType, finalKey, ...leaf }));
  });

  currentKeys.forEach((finalKey) => {
    if (!baselineKeySet.has(finalKey)) {
      unresolved.push({ entryType, finalKey, reason: 'entry-added' });
    }
  });
}

// Tags live as an array in a spec, but (like paths and each components/*
// sub-collection) are addressed by name everywhere else in this feature
// (provenance, conflict resolution) -- keyed here the same way so
// diffEntries can treat all three collections identically.
function tagsByName(spec) {
  const map = {};
  (spec.tags || []).forEach((tag) => {
    map[tag.name] = tag;
  });
  return map;
}

// Walks a baseline and current merged spec (both plain JS objects, e.g. from
// YAML.load) and reports every in-scope change plus everything it declined
// to resolve. See the module comment above for what "in-scope" means.
// eslint-disable-next-line import/prefer-default-export
export function diffAggregatedSpecs(baseline, current) {
  const resolved = [];
  const unresolved = [];

  diffEntries('paths', baseline.paths || {}, current.paths || {}, resolved, unresolved);
  diffEntries('tags', tagsByName(baseline), tagsByName(current), resolved, unresolved);
  COMPONENT_TYPES.forEach((type) => {
    diffEntries(
      type,
      baseline.components?.[type] || {},
      current.components?.[type] || {},
      resolved,
      unresolved
    );
  });

  return { resolved, unresolved };
}
