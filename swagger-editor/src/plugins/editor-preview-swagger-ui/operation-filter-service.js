import YAML from 'js-yaml';

// Fixed order -- matches the order OpenAPI itself defines operations in
// under a path item, and swagger-ui-react's own validOperationMethods list
// (including OpenAPI 3.2's QUERY method, added last in both).
export const OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
];

// Component sub-collections a $ref can point into. Deliberately the same
// list aggregation-merge-service.js merges (OpenAPI 3's components object)
// -- this app's pruning logic only ever needs to reason about that one
// shape, and keeping both lists in sync means a spec that round-trips
// through Aggregate and this filter behaves consistently. A Swagger 2.0
// document has no `components` object at all, so pruning against this list
// is simply a no-op for one -- not a special case.
const COMPONENT_TYPES = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
];

const REF_PATTERN = /^#\/components\/([^/]+)\/(.+)$/;

// Parses whatever's in the editor (JSON or YAML -- js-yaml reads both) into
// a plain object, the same approach aggregation-merge-service.js uses for
// specs it fetches over the network.
export function parseSpecContent(content) {
  return YAML.load(content);
}

export function operationKey(path, method) {
  return `${method.toUpperCase()} ${path}`;
}

// Every operation in the spec, in a stable order.
export function listOperations(spec) {
  const operations = [];
  Object.entries(spec?.paths || {}).forEach(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }
    OPERATION_METHODS.forEach((method) => {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') {
        return;
      }
      operations.push({
        key: operationKey(path, method),
        path,
        method,
        tags: operation.tags || [],
      });
    });
  });
  return operations;
}

// Recursively collects every "#/components/<type>/<name>" $ref inside
// `node`, adding each to `into` (a Map of type -> Set of names). Plain
// object walk rather than a JSON-schema-aware one -- a $ref is always a
// string value under a "$ref" key wherever it appears (schemas, parameters,
// responses, callbacks, ...), so this doesn't need to know the shape it's
// walking, just how to walk it.
function collectComponentRefs(node, into) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectComponentRefs(child, into));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  Object.entries(node).forEach(([key, value]) => {
    if (key === '$ref' && typeof value === 'string') {
      const match = value.match(REF_PATTERN);
      if (match) {
        const [, type, name] = match;
        if (!into.has(type)) into.set(type, new Set());
        into.get(type).add(name);
      }
      return;
    }
    collectComponentRefs(value, into);
  });
}

// A security requirement object (OpenAPI's `security: [{ apiKey: [] }]`
// shape, at either the document or the operation level) names a security
// scheme as a plain object key, not a $ref -- collectComponentRefs above
// can't see these, so they're gathered separately and folded into the same
// reachability map under the fixed 'securitySchemes' type.
function collectSecuritySchemeNames(securityRequirements, into) {
  (securityRequirements || []).forEach((requirement) => {
    Object.keys(requirement || {}).forEach((name) => {
      if (!into.has('securitySchemes')) into.set('securitySchemes', new Set());
      into.get('securitySchemes').add(name);
    });
  });
}

// Explicit worklist rather than looping until a re-scan finds nothing new --
// a component definition can itself reference further components (a schema
// nesting another schema, a response referencing a header, ...), and a
// worklist visits each newly-discovered one exactly once without relying on
// how Map/Set.forEach happens to behave when mutated mid-iteration.
function resolveTransitiveComponentRefs(seeds, spec) {
  const reachable = new Map(); // type -> Set(name)
  const queue = [];
  const add = (type, name) => {
    if (!reachable.has(type)) reachable.set(type, new Set());
    if (!reachable.get(type).has(name)) {
      reachable.get(type).add(name);
      queue.push([type, name]);
    }
  };
  seeds.forEach((names, type) => names.forEach((name) => add(type, name)));

  while (queue.length > 0) {
    const [type, name] = queue.pop();
    const definition = spec.components?.[type]?.[name];
    if (definition !== undefined) {
      const nested = new Map();
      collectComponentRefs(definition, nested);
      nested.forEach((names, nestedType) =>
        names.forEach((nestedName) => add(nestedType, nestedName))
      );
    }
  }

  return reachable;
}

// Builds a copy of `spec` containing only the operations named in
// `selectedKeys` (operationKey(path, method) values), with every
// components/* entry and top-level tag that's no longer reachable from a
// surviving operation dropped too -- so removing an endpoint doesn't leave
// dead $refs or tag groupings behind. Doesn't mutate `spec`.
export function buildSubsetSpec(spec, selectedKeys) {
  const selected = new Set(selectedKeys);
  const subset = { ...spec, paths: {} };

  const seeds = new Map(); // type -> Set(name)
  collectSecuritySchemeNames(spec.security, seeds);

  const survivingOperationTags = new Set();

  Object.entries(spec.paths || {}).forEach(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }
    const survivingPathItem = {};
    let hasSurvivingOperation = false;

    Object.entries(pathItem).forEach(([key, value]) => {
      if (!OPERATION_METHODS.includes(key)) {
        // Shared, non-operation fields on the path item (parameters,
        // summary, description, servers, $ref, x-* extensions) travel with
        // the path whenever any of its operations survive.
        survivingPathItem[key] = value;
        return;
      }
      if (!selected.has(operationKey(path, key))) {
        return;
      }
      hasSurvivingOperation = true;
      survivingPathItem[key] = value;
      (value.tags || []).forEach((tag) => survivingOperationTags.add(tag));
      collectSecuritySchemeNames(value.security, seeds);
    });

    if (hasSurvivingOperation) {
      subset.paths[path] = survivingPathItem;
      collectComponentRefs(survivingPathItem, seeds);
    }
  });

  const reachable = resolveTransitiveComponentRefs(seeds, spec);

  if (spec.components) {
    const components = {};
    COMPONENT_TYPES.forEach((type) => {
      const names = reachable.get(type);
      if (!names || !spec.components[type]) {
        return;
      }
      const kept = {};
      Object.keys(spec.components[type]).forEach((name) => {
        if (names.has(name)) {
          kept[name] = spec.components[type][name];
        }
      });
      if (Object.keys(kept).length > 0) {
        components[type] = kept;
      }
    });
    if (Object.keys(components).length > 0) {
      subset.components = components;
    } else {
      delete subset.components;
    }
  }

  if (spec.tags) {
    const keptTags = spec.tags.filter((tag) => survivingOperationTags.has(tag.name));
    if (keptTags.length > 0) {
      subset.tags = keptTags;
    } else {
      delete subset.tags;
    }
  }

  if (Object.keys(subset.paths).length === 0) {
    delete subset.paths;
  }

  return subset;
}

// Re-serializes `spec` matching the format (`isYAML`) the editor's current
// content is already in, so removing an endpoint doesn't silently convert
// a YAML document to JSON or vice versa.
export function serializeSpec(spec, isYAML) {
  return isYAML ? YAML.dump(spec, { lineWidth: -1 }) : JSON.stringify(spec, null, 2);
}

// Every components/<type>/<name> entry present in `before` but absent from
// `after`, as { type: { name: definition } } -- what a removal step pruned
// as a side effect, and therefore what a later restore of that same
// operation needs to bring back.
function diffComponents(before, after) {
  const removed = {};
  COMPONENT_TYPES.forEach((type) => {
    const beforeType = before?.[type];
    if (!beforeType) {
      return;
    }
    const afterType = after?.[type] || {};
    Object.entries(beforeType).forEach(([name, definition]) => {
      if (!(name in afterType)) {
        if (!removed[type]) removed[type] = {};
        removed[type][name] = definition;
      }
    });
  });
  return removed;
}

// Every tag object present in `before` but absent (by name) from `after`,
// each paired with the name of whichever tag preceded it in
// `referenceTags`'s own order (or null if it was first, undefined if it
// can't be found there at all) -- the same positional bookkeeping
// removeOperation does for paths/methods, so a later restore can put a
// dropped tag section back where it was instead of appending it at the
// end. `referenceTags` defaults to `before`, correct for a single
// removal, but a caller batching several removals together (see
// removeOperationsFromContent) passes the pre-batch tags list instead --
// by the time a later step's `before` runs, it may already be missing an
// earlier step's own dropped tag, which would otherwise make that earlier
// tag disappear as a *reachable* neighbor even though it was right there
// a moment ago.
function diffTags(before, after, referenceTags = before) {
  const referenceList = referenceTags || [];
  const afterNames = new Set((after || []).map((tag) => tag.name));
  return (before || [])
    .filter((tag) => !afterNames.has(tag.name))
    .map((tag) => {
      const index = referenceList.findIndex((candidate) => candidate.name === tag.name);
      let precedingTag;
      if (index === -1) {
        precedingTag = undefined;
      } else if (index === 0) {
        precedingTag = null;
      } else {
        precedingTag = referenceList[index - 1].name;
      }
      return { tag, precedingTag };
    });
}

// Inserts `key: value` into a shallow copy of `obj`, positioned right after
// `precedingKey` -- `null` means "insert first", `undefined` means "no
// position info available, just append" (keeps the old append-at-the-end
// behavior for any caller that doesn't have it, e.g. hand-built records in
// tests). Falls back to appending when `precedingKey` no longer exists in
// `obj` either (its own former neighbor is gone too) -- the closest
// approximation to "back where it was" once the surrounding keys have
// themselves changed.
function insertPreservingOrder(obj, key, value, precedingKey) {
  if (precedingKey === undefined || (precedingKey !== null && !(precedingKey in obj))) {
    return { ...obj, [key]: value };
  }
  const result = {};
  if (precedingKey === null) {
    result[key] = value;
  }
  Object.entries(obj).forEach(([k, v]) => {
    result[k] = v;
    if (k === precedingKey) {
      result[key] = value;
    }
  });
  return result;
}

// Removes one operation from `spec`, returning both the pruned spec and a
// self-contained record of what that removal took with it -- the operation
// itself, plus the components/tags that were only reachable because of it,
// plus where it sat (precedingPath among its sibling paths, precedingMethod
// among its own path item's other keys) so a later restore can put it back
// in the same spot instead of at the end. That record is exactly what
// restoreOperation needs later to put the operation back exactly as it was,
// independent of whatever else has changed in the spec since. Returns null
// if the operation isn't there.
//
// `referenceSpec` is where precedingPath/precedingMethod/precedingTag are
// looked up -- it defaults to `spec` itself, correct for a standalone
// removal, but removeOperationsFromContent passes the *pre-batch* spec
// when removing several operations in sequence. Without that, a later
// step's own `spec` would already be missing whatever an earlier step in
// the same batch just removed, so a path/method/tag that really did sit
// right next to one of its own batch-mates would wrongly come back
// recorded as having been first (or last), corrupting the order restore
// puts them back in.
export function removeOperation(spec, path, method, referenceSpec = spec) {
  const key = operationKey(path, method);
  const allKeys = listOperations(spec).map((operation) => operation.key);
  if (!allKeys.includes(key)) {
    return null;
  }

  const referencePathKeys = Object.keys(referenceSpec.paths || {});
  const pathIndex = referencePathKeys.indexOf(path);
  const precedingPath = pathIndex === 0 ? null : referencePathKeys[pathIndex - 1];

  const referencePathItemKeys = Object.keys(referenceSpec.paths[path]);
  const methodIndex = referencePathItemKeys.indexOf(method);
  const precedingMethod = methodIndex === 0 ? null : referencePathItemKeys[methodIndex - 1];

  const operation = spec.paths[path][method];
  const remainingKeys = allKeys.filter((k) => k !== key);
  const nextSpec = buildSubsetSpec(spec, remainingKeys);
  const record = {
    path,
    method,
    operation,
    precedingPath,
    precedingMethod,
    removedComponents: diffComponents(spec.components, nextSpec.components),
    removedTags: diffTags(spec.tags, nextSpec.tags, referenceSpec.tags),
  };
  return { spec: nextSpec, record };
}

// Puts a previously-removed operation (and whatever components/tags its
// removal took with it) back into `spec`, at (or as close as currently
// possible to) the position it was removed from -- see
// insertPreservingOrder. Safe to apply against a spec that's since been
// edited elsewhere -- it only ever adds the path/components/tags the record
// names, in addition to whatever else the current spec has going on.
// Doesn't mutate `spec`.
export function restoreOperation(spec, record) {
  const nextSpec = { ...spec };

  const paths = spec.paths || {};
  if (Object.prototype.hasOwnProperty.call(paths, record.path)) {
    const pathItem = insertPreservingOrder(
      paths[record.path],
      record.method,
      record.operation,
      record.precedingMethod
    );
    nextSpec.paths = { ...paths, [record.path]: pathItem };
  } else {
    nextSpec.paths = insertPreservingOrder(
      paths,
      record.path,
      { [record.method]: record.operation },
      record.precedingPath
    );
  }

  if (record.removedComponents && Object.keys(record.removedComponents).length > 0) {
    const components = { ...(spec.components || {}) };
    Object.entries(record.removedComponents).forEach(([type, definitions]) => {
      const existing = { ...(components[type] || {}) };
      Object.entries(definitions).forEach(([name, definition]) => {
        if (!(name in existing)) {
          existing[name] = definition;
        }
      });
      components[type] = existing;
    });
    nextSpec.components = components;
  }

  if (record.removedTags && record.removedTags.length > 0) {
    let tagsByName = {};
    (spec.tags || []).forEach((tag) => {
      tagsByName[tag.name] = tag;
    });
    record.removedTags.forEach((entry) => {
      // Normally { tag, precedingTag } (see diffTags), but a hand-built
      // record (tests, or one from before this positional bookkeeping
      // existed) may be a plain tag object instead -- treated the same as
      // "no position info", same as a missing precedingPath/precedingMethod.
      const isWrapped = entry && typeof entry === 'object' && 'tag' in entry;
      const tag = isWrapped ? entry.tag : entry;
      const precedingTag = isWrapped ? entry.precedingTag : undefined;
      if (!(tag.name in tagsByName)) {
        tagsByName = insertPreservingOrder(tagsByName, tag.name, tag, precedingTag);
      }
    });
    nextSpec.tags = Object.values(tagsByName);
  }

  return nextSpec;
}

// The content the editor should switch to once every operation in `keys`
// ([{ path, method }, ...]) is removed -- parses `content` once, removes
// each in turn (each against the result of the last, so a later removal's
// component/tag pruning correctly accounts for an earlier one in the same
// batch), and re-serializes once matching the original format. Returns
// null if content isn't parsable right now, or none of `keys` were found.
//
// Each removeOperation call gets the pre-batch spec as its reference for
// recording precedingPath/precedingMethod/precedingTag, not the
// progressively-shrinking `spec` -- otherwise removing two adjacent
// operations together (e.g. a tag's "Remove all") would have the second
// one's removal see the first one already gone, wrongly recording it as
// having had no predecessor.
export function removeOperationsFromContent(content, keys, isYAML) {
  let spec;
  try {
    spec = parseSpecContent(content);
  } catch {
    return null;
  }
  const referenceSpec = spec;
  const records = [];
  keys.forEach(({ path, method }) => {
    const result = removeOperation(spec, path, method, referenceSpec);
    if (result) {
      spec = result.spec;
      records.push(result.record);
    }
  });
  if (records.length === 0) {
    return null;
  }
  return { content: serializeSpec(spec, isYAML), records };
}

// Single-operation convenience wrapper around removeOperationsFromContent,
// for the common case (one checkbox unchecked).
export function removeOperationFromContent(content, path, method, isYAML) {
  const result = removeOperationsFromContent(content, [{ path, method }], isYAML);
  return result && { content: result.content, record: result.records[0] };
}

// Whether `record` is safe to restore right now: its path (or, once that
// path exists, its method) needs its recorded neighbor to already be
// present -- either because that neighbor survived the original removal,
// or because this same batch already restored it. A record with no
// position info to begin with (precedingPath/precedingMethod both absent)
// is always ready, since it only ever appends anyway. `pending` is every
// record not yet restored in this batch, `record` included -- used to
// tell "nothing will ever create that neighbor" (ready, will fall back to
// appending) apart from "some other pending record in this batch will"
// (not ready yet, wait for it).
function isReadyToRestore(spec, record, pending) {
  const paths = spec.paths || {};
  if (!Object.prototype.hasOwnProperty.call(paths, record.path)) {
    const { precedingPath } = record;
    if (precedingPath === null || precedingPath === undefined) {
      return true;
    }
    if (Object.prototype.hasOwnProperty.call(paths, precedingPath)) {
      return true;
    }
    return !pending.some((other) => other !== record && other.path === precedingPath);
  }
  const { precedingMethod } = record;
  if (precedingMethod === null || precedingMethod === undefined) {
    return true;
  }
  if (precedingMethod in paths[record.path]) {
    return true;
  }
  return !pending.some(
    (other) => other !== record && other.path === record.path && other.method === precedingMethod
  );
}

// The content the editor should switch to once every record in `records`
// is restored -- parses `content` once, restores them in whichever order
// correctly threads their positional dependencies (not necessarily the
// order they arrived in: restoring two operations removed from adjacent
// paths needs the earlier one back first, or the later one's
// precedingPath won't exist yet and it'll wrongly fall back to landing at
// the end -- see isReadyToRestore), and re-serializes once matching the
// original format. Returns null if content isn't parsable right now.
export function restoreOperationsInContent(content, records, isYAML) {
  let spec;
  try {
    spec = parseSpecContent(content);
  } catch {
    return null;
  }
  const pending = [...records];
  while (pending.length > 0) {
    let readyIndex = -1;
    for (let i = 0; i < pending.length; i += 1) {
      if (isReadyToRestore(spec, pending[i], pending)) {
        readyIndex = i;
        break;
      }
    }
    const [record] = pending.splice(readyIndex === -1 ? 0 : readyIndex, 1);
    spec = restoreOperation(spec, record);
  }
  return serializeSpec(spec, isYAML);
}

// Single-record convenience wrapper around restoreOperationsInContent.
export function restoreOperationInContent(content, record, isYAML) {
  return restoreOperationsInContent(content, [record], isYAML);
}
