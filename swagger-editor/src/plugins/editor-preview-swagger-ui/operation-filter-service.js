import YAML from 'js-yaml';

// Fixed order -- matches the order OpenAPI itself defines operations in
// under a path item.
export const OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
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
      operations.push({ key: operationKey(path, method), path, method });
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

// The content the editor should switch to once `path`/`method` is removed --
// parses `content`, drops that one operation (and anything only it kept
// reachable), and re-serializes matching the original format. Returns null
// if `content` isn't parsable right now (e.g. mid-edit) or the operation is
// already gone -- nothing sensible to do in either case.
export function removeOperationFromContent(content, path, method, isYAML) {
  let spec;
  try {
    spec = parseSpecContent(content);
  } catch {
    return null;
  }
  const removedKey = operationKey(path, method);
  const allKeys = listOperations(spec).map((operation) => operation.key);
  if (!allKeys.includes(removedKey)) {
    return null;
  }
  const remainingKeys = allKeys.filter((key) => key !== removedKey);
  const subset = buildSubsetSpec(spec, remainingKeys);
  return serializeSpec(subset, isYAML);
}
