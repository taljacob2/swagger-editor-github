import YAML from 'js-yaml';

// Component sub-collections that can each independently collide by name
// across services — mirrors OpenAPI 3's components object.
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

const RAW_GITHUB_CONTENT_HOSTS = ['raw.githubusercontent.com'];

// Only attach the PAT to requests that are actually going to GitHub — never
// to an arbitrary third-party URL a set happens to reference, which would
// leak the token to whatever server is on the other end.
function shouldAttachToken(url, apiBaseUrl) {
  try {
    const targetHost = new URL(url).hostname;
    const apiHost = new URL(apiBaseUrl).hostname;
    return targetHost === apiHost || RAW_GITHUB_CONTENT_HOSTS.includes(targetHost);
  } catch {
    return false;
  }
}

export async function fetchSpec(url, connection) {
  // Prefer a dedicated read-only fetch token when one is set, so a token
  // scoped only to fetching specs never needs the broader write access the
  // main repo token carries. Falls back to the repo token when unset.
  const token = connection.fetchToken || connection.token;
  const headers = {};
  if (token && shouldAttachToken(url, connection.apiBaseUrl)) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  return YAML.load(text);
}

function buildInfo(specs, overrides = {}) {
  return {
    title: overrides.title || 'Aggregated API',
    version: overrides.version || '1.0.0',
    description:
      overrides.description ||
      `Aggregated API from ${specs.length} microservices: ${specs.map((s) => s.name).join(', ')}`,
    ...(overrides.termsOfService ? { termsOfService: overrides.termsOfService } : {}),
    ...(overrides.contact ? { contact: overrides.contact } : {}),
    ...(overrides.license ? { license: overrides.license } : {}),
  };
}

// Merges multiple OpenAPI 3 specs into one, prefixing only names that
// actually collide across services (paths, tags, and each components/*
// sub-collection tracked independently — a "Parameters" schema and a
// "Parameters" response don't collide with each other just because they
// share a name). Ported from swagger-editor-gitlab's mergeSwaggerSpecs;
// see docs/Aggregation.md for the user-facing conflict-resolution rules.
export function mergeSpecs(specs, infoOverrides = {}) {
  if (specs.length === 0) {
    return null;
  }
  if (specs.length === 1) {
    return { merged: specs[0].spec, conflicts: { paths: [], tags: [], components: [] } };
  }

  const merged = {
    openapi: '3.0.0',
    info: buildInfo(specs, infoOverrides),
    servers: [],
    paths: {},
    components: Object.fromEntries(COMPONENT_TYPES.map((type) => [type, {}])),
    tags: [],
    security: [],
  };

  const conflicts = { paths: [], tags: [], components: [] };

  // First pass: who owns each name, so we only prefix real collisions.
  const pathOwners = new Map();
  const tagOwners = new Map();
  const componentOwners = new Map(); // key: `${type}:${name}` -> [service names]

  specs.forEach(({ name, spec }) => {
    Object.keys(spec.paths || {}).forEach((path) => {
      if (!pathOwners.has(path)) pathOwners.set(path, []);
      pathOwners.get(path).push(name);
    });
    (spec.tags || []).forEach((tag) => {
      if (!tagOwners.has(tag.name)) tagOwners.set(tag.name, []);
      tagOwners.get(tag.name).push(name);
    });
    COMPONENT_TYPES.forEach((type) => {
      Object.keys(spec.components?.[type] || {}).forEach((componentName) => {
        const key = `${type}:${componentName}`;
        if (!componentOwners.has(key)) componentOwners.set(key, []);
        componentOwners.get(key).push(name);
      });
    });
  });

  pathOwners.forEach((services, path) => {
    if (services.length > 1) conflicts.paths.push({ path, services });
  });
  tagOwners.forEach((services, tagName) => {
    if (services.length > 1) conflicts.tags.push({ tagName, services });
  });
  componentOwners.forEach((services, key) => {
    if (services.length > 1) {
      const [type, name] = key.split(':');
      conflicts.components.push({ type, name, services });
    }
  });

  // Second pass: merge, prefixing only what collided above.
  specs.forEach(({ name, spec }) => {
    const prefix = name.toLowerCase().replace(/[^a-z0-9]/g, '');

    (spec.servers || []).forEach((server) => {
      const exists = merged.servers.some((s) => JSON.stringify(s) === JSON.stringify(server));
      if (!exists) merged.servers.push(server);
    });

    Object.entries(spec.paths || {}).forEach(([path, pathItem]) => {
      const hasConflict = pathOwners.get(path)?.length > 1;
      const finalPath = hasConflict ? `/${prefix}${path}` : path;

      const clonedPathItem = { ...pathItem };
      Object.entries(clonedPathItem).forEach(([key, operation]) => {
        if (operation && typeof operation === 'object' && Array.isArray(operation.tags)) {
          clonedPathItem[key] = {
            ...operation,
            tags: operation.tags.map((tag) =>
              tagOwners.get(tag)?.length > 1 ? `${name}-${tag}` : tag
            ),
          };
        }
      });
      merged.paths[finalPath] = clonedPathItem;
    });

    COMPONENT_TYPES.forEach((type) => {
      Object.entries(spec.components?.[type] || {}).forEach(([componentName, componentDef]) => {
        const hasConflict = componentOwners.get(`${type}:${componentName}`)?.length > 1;
        const finalName = hasConflict ? `${name}${componentName}` : componentName;
        merged.components[type][finalName] = componentDef;
      });
    });

    (spec.tags || []).forEach((tag) => {
      const hasConflict = tagOwners.get(tag.name)?.length > 1;
      merged.tags.push({
        ...tag,
        name: hasConflict ? `${name}-${tag.name}` : tag.name,
        ...(hasConflict ? { description: `${tag.description || ''} (from ${name})`.trim() } : {}),
      });
    });

    (spec.security || []).forEach((securityItem) => {
      const exists = merged.security.some(
        (s) => JSON.stringify(s) === JSON.stringify(securityItem)
      );
      if (!exists) merged.security.push(securityItem);
    });
  });

  // Trim empties so the merged spec doesn't carry noise the source specs
  // never had.
  COMPONENT_TYPES.forEach((type) => {
    if (Object.keys(merged.components[type]).length === 0) delete merged.components[type];
  });
  if (Object.keys(merged.components).length === 0) delete merged.components;
  if (merged.servers.length === 0) delete merged.servers;
  if (merged.tags.length === 0) delete merged.tags;
  if (merged.security.length === 0) delete merged.security;
  if (Object.keys(merged.paths).length === 0) delete merged.paths;

  return { merged, conflicts };
}

// Fetches every URL in a saved set, merges what succeeded, and returns the
// result as YAML text ready for the editor. Partial failures don't abort the
// whole aggregation — one unreachable service shouldn't block the rest.
export async function aggregateSet(set, connection) {
  const urls = set.swaggerUrls || [];
  const results = await Promise.allSettled(
    urls.map(async (entry) => ({ name: entry.name, spec: await fetchSpec(entry.url, connection) }))
  );

  const specs = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      specs.push(result.value);
    } else {
      errors.push({ name: urls[index].name, message: result.reason.message });
    }
  });

  if (specs.length === 0) {
    throw new Error('No specs could be fetched for this set.');
  }

  const { merged, conflicts } = mergeSpecs(specs, { title: set.name });
  const yaml = YAML.dump(merged, { lineWidth: -1 });

  return { yaml, conflicts, errors, specCount: specs.length };
}
