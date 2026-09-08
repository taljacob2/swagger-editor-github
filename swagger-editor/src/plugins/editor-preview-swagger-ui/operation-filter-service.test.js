import {
  buildSubsetSpec,
  listOperations,
  operationKey,
  parseSpecContent,
  removeOperation,
  removeOperationFromContent,
  removeOperationsFromContent,
  restoreOperation,
  restoreOperationInContent,
  restoreOperationsInContent,
  serializeSpec,
} from './operation-filter-service.js';

describe('parseSpecContent', () => {
  test('parses YAML content', () => {
    expect(parseSpecContent('openapi: 3.0.0\ninfo:\n  title: X\n')).toEqual({
      openapi: '3.0.0',
      info: { title: 'X' },
    });
  });

  test('parses JSON content (valid YAML too)', () => {
    expect(parseSpecContent('{"openapi": "3.0.0"}')).toEqual({ openapi: '3.0.0' });
  });
});

describe('operationKey', () => {
  test('combines an uppercased method and the path', () => {
    expect(operationKey('/pet/{petId}', 'get')).toBe('GET /pet/{petId}');
  });
});

describe('listOperations', () => {
  test('lists every operation across every path, in method order', () => {
    const spec = {
      paths: {
        '/pet': { post: {}, put: {} },
        '/pet/{petId}': { get: {} },
      },
    };

    expect(listOperations(spec)).toEqual([
      { key: 'PUT /pet', path: '/pet', method: 'put', tags: [] },
      { key: 'POST /pet', path: '/pet', method: 'post', tags: [] },
      { key: 'GET /pet/{petId}', path: '/pet/{petId}', method: 'get', tags: [] },
    ]);
  });

  test("includes each operation's own tags", () => {
    const spec = { paths: { '/pet': { get: { tags: ['pet', 'read'] } } } };

    expect(listOperations(spec)[0].tags).toEqual(['pet', 'read']);
  });

  test('ignores non-operation path-item fields', () => {
    const spec = {
      paths: {
        '/pet': {
          parameters: [{ name: 'shared', in: 'query' }],
          summary: 'shared summary',
          get: {},
        },
      },
    };

    expect(listOperations(spec)).toEqual([
      { key: 'GET /pet', path: '/pet', method: 'get', tags: [] },
    ]);
  });

  test('returns an empty list for a spec with no paths', () => {
    expect(listOperations({})).toEqual([]);
    expect(listOperations(undefined)).toEqual([]);
  });

  test("recognizes OpenAPI 3.2's QUERY method like any other operation", () => {
    const spec = { paths: { '/pet': { query: { tags: ['pet'] } } } };

    expect(listOperations(spec)).toEqual([
      { key: 'QUERY /pet', path: '/pet', method: 'query', tags: ['pet'] },
    ]);
  });
});

describe('buildSubsetSpec', () => {
  test('keeps only the selected operations, dropping paths left with none', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/pet': { post: {}, put: {} },
        '/store/order': { get: {} },
      },
    };

    const subset = buildSubsetSpec(spec, ['POST /pet']);

    expect(subset.paths).toEqual({ '/pet': { post: {} } });
  });

  test("keeps a surviving path item's shared non-operation fields", () => {
    const spec = {
      paths: {
        '/pet': {
          parameters: [{ name: 'shared', in: 'query' }],
          get: {},
          post: {},
        },
      },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(subset.paths['/pet']).toEqual({
      parameters: [{ name: 'shared', in: 'query' }],
      get: {},
    });
  });

  test('drops the paths key entirely when nothing survives', () => {
    const spec = { paths: { '/pet': { get: {} } } };
    expect(buildSubsetSpec(spec, [])).not.toHaveProperty('paths');
  });

  test('does not mutate the input spec', () => {
    const spec = { paths: { '/pet': { get: {}, post: {} } } };
    buildSubsetSpec(spec, ['GET /pet']);
    expect(Object.keys(spec.paths['/pet'])).toEqual(['get', 'post']);
  });

  test('keeps a QUERY-only path untouched when an unrelated operation is removed', () => {
    const spec = {
      paths: {
        '/pet': { get: {} },
        '/pet/search': { query: {} },
      },
    };

    const subset = buildSubsetSpec(spec, ['QUERY /pet/search']);

    expect(subset.paths).toEqual({ '/pet/search': { query: {} } });
  });

  test('prunes a components/schemas entry no surviving operation references', () => {
    const spec = {
      paths: {
        '/pet': { get: { responses: { 200: { $ref: '#/components/responses/PetResponse' } } } },
        '/order': {
          get: { responses: { 200: { $ref: '#/components/responses/OrderResponse' } } },
        },
      },
      components: {
        responses: {
          PetResponse: { description: 'a pet' },
          OrderResponse: { description: 'an order' },
        },
      },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(subset.components.responses).toEqual({ PetResponse: { description: 'a pet' } });
  });

  test('keeps a component transitively referenced through another component', () => {
    const spec = {
      paths: {
        '/pet': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            properties: { category: { $ref: '#/components/schemas/Category' } },
          },
          Category: { type: 'object' },
          Unrelated: { type: 'object' },
        },
      },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(Object.keys(subset.components.schemas).sort()).toEqual(['Category', 'Pet']);
  });

  test('keeps a security scheme referenced by a surviving operation', () => {
    const spec = {
      paths: {
        '/pet': { post: { security: [{ apiKey: [] }] } },
        '/order': { get: { security: [{ oauth: ['read'] }] } },
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', name: 'api_key', in: 'header' },
          oauth: { type: 'oauth2' },
        },
      },
    };

    const subset = buildSubsetSpec(spec, ['POST /pet']);

    expect(Object.keys(subset.components.securitySchemes)).toEqual(['apiKey']);
  });

  test('keeps a security scheme referenced only by the document-level security requirement', () => {
    const spec = {
      security: [{ apiKey: [] }],
      paths: { '/pet': { get: {} } },
      components: { securitySchemes: { apiKey: { type: 'apiKey' } } },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(subset.components.securitySchemes).toEqual({ apiKey: { type: 'apiKey' } });
  });

  test('drops components entirely once nothing is reachable', () => {
    const spec = {
      paths: {
        '/pet': { get: {} },
        '/order': {
          get: { responses: { 200: { $ref: '#/components/responses/OrderResponse' } } },
        },
      },
      components: { responses: { OrderResponse: { description: 'x' } } },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(subset).not.toHaveProperty('components');
  });

  test('prunes a top-level tag no surviving operation uses', () => {
    const spec = {
      tags: [{ name: 'pet' }, { name: 'store' }],
      paths: {
        '/pet': { get: { tags: ['pet'] } },
        '/store/order': { post: { tags: ['store'] } },
      },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(subset.tags).toEqual([{ name: 'pet' }]);
  });

  test('drops the tags key entirely once none survive', () => {
    const spec = {
      tags: [{ name: 'store' }],
      paths: { '/store/order': { post: { tags: ['store'] } } },
    };

    expect(buildSubsetSpec(spec, [])).not.toHaveProperty('tags');
  });

  test('leaves security, servers, and info untouched', () => {
    const spec = {
      info: { title: 'X', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      security: [{ apiKey: [] }],
      paths: { '/pet': { get: {} } },
    };

    const subset = buildSubsetSpec(spec, ['GET /pet']);

    expect(subset.info).toEqual(spec.info);
    expect(subset.servers).toEqual(spec.servers);
    expect(subset.security).toEqual(spec.security);
  });
});

describe('serializeSpec', () => {
  test('dumps as YAML when isYAML is true', () => {
    expect(serializeSpec({ openapi: '3.0.0' }, true)).toBe('openapi: 3.0.0\n');
  });

  test('stringifies as JSON when isYAML is false', () => {
    expect(serializeSpec({ openapi: '3.0.0' }, false)).toBe('{\n  "openapi": "3.0.0"\n}');
  });
});

describe('removeOperation', () => {
  test('returns the pruned spec and a record of what was removed', () => {
    const spec = {
      paths: {
        '/pet': {
          get: {
            tags: ['pet'],
            responses: { 200: { $ref: '#/components/responses/PetResponse' } },
          },
        },
      },
      tags: [{ name: 'pet' }],
      components: { responses: { PetResponse: { description: 'a pet' } } },
    };

    const result = removeOperation(spec, '/pet', 'get');

    expect(result.spec).not.toHaveProperty('paths');
    expect(result.record).toEqual({
      path: '/pet',
      method: 'get',
      operation: spec.paths['/pet'].get,
      precedingPath: null,
      precedingMethod: null,
      removedComponents: { responses: { PetResponse: { description: 'a pet' } } },
      removedTags: [{ tag: { name: 'pet' }, precedingTag: null }],
    });
  });

  test('returns null when the operation is not in the spec', () => {
    expect(removeOperation({ paths: {} }, '/pet', 'get')).toBeNull();
  });

  test('records the sibling path/method that came right before the one removed', () => {
    const spec = {
      paths: {
        '/pet': { get: {}, post: {} },
        '/store/order': { get: {} },
      },
    };

    expect(removeOperation(spec, '/pet', 'post').record).toMatchObject({
      precedingPath: null,
      precedingMethod: 'get',
    });
    expect(removeOperation(spec, '/store/order', 'get').record).toMatchObject({
      precedingPath: '/pet',
      precedingMethod: null,
    });
  });

  test('records the sibling tag that came right before each dropped tag', () => {
    const spec = {
      tags: [{ name: 'pet' }, { name: 'store' }, { name: 'user' }],
      paths: {
        '/pet': { get: { tags: ['pet'] } },
        '/store/order': { post: { tags: ['store'] } },
        '/user': { post: { tags: ['user'] } },
      },
    };

    expect(removeOperation(spec, '/store/order', 'post').record.removedTags).toEqual([
      { tag: { name: 'store' }, precedingTag: 'pet' },
    ]);
    expect(removeOperation(spec, '/pet', 'get').record.removedTags).toEqual([
      { tag: { name: 'pet' }, precedingTag: null },
    ]);
  });
});

describe('restoreOperation', () => {
  test('puts the operation, its components, and its tags back', () => {
    const spec = { paths: {} };
    const record = {
      path: '/pet',
      method: 'get',
      operation: { tags: ['pet'], responses: {} },
      removedComponents: { responses: { PetResponse: { description: 'a pet' } } },
      removedTags: [{ name: 'pet' }],
    };

    const restored = restoreOperation(spec, record);

    expect(restored.paths['/pet'].get).toEqual(record.operation);
    expect(restored.components.responses.PetResponse).toEqual({ description: 'a pet' });
    expect(restored.tags).toEqual([{ name: 'pet' }]);
  });

  test('adds to an existing path item without disturbing its other operations', () => {
    const spec = { paths: { '/pet': { post: { summary: 'add' } } } };
    const record = { path: '/pet', method: 'get', operation: { summary: 'list' } };

    const restored = restoreOperation(spec, record);

    expect(restored.paths['/pet']).toEqual({ post: { summary: 'add' }, get: { summary: 'list' } });
  });

  test('does not duplicate a component or tag already present', () => {
    const spec = {
      components: { responses: { PetResponse: { description: 'current' } } },
      tags: [{ name: 'pet', description: 'current' }],
      paths: {},
    };
    const record = {
      path: '/pet',
      method: 'get',
      operation: {},
      removedComponents: { responses: { PetResponse: { description: 'stale' } } },
      removedTags: [{ name: 'pet', description: 'stale' }],
    };

    const restored = restoreOperation(spec, record);

    expect(restored.components.responses.PetResponse).toEqual({ description: 'current' });
    expect(restored.tags).toEqual([{ name: 'pet', description: 'current' }]);
  });

  test('does not mutate the input spec', () => {
    const spec = { paths: {} };
    restoreOperation(spec, { path: '/pet', method: 'get', operation: {} });
    expect(spec.paths).toEqual({});
  });

  test('reinserts a fully-removed path back at its original position among siblings', () => {
    const spec = { paths: { '/pet': { get: {} }, '/store/order': { get: {} } } };
    const record = {
      path: '/pet/findByStatus',
      method: 'get',
      operation: { summary: 'list' },
      precedingPath: '/pet',
    };

    const restored = restoreOperation(spec, record);

    expect(Object.keys(restored.paths)).toEqual(['/pet', '/pet/findByStatus', '/store/order']);
  });

  test('reinserts a path at the front when it was originally first', () => {
    const spec = { paths: { '/store/order': { get: {} } } };
    const record = {
      path: '/pet',
      method: 'get',
      operation: { summary: 'list' },
      precedingPath: null,
    };

    const restored = restoreOperation(spec, record);

    expect(Object.keys(restored.paths)).toEqual(['/pet', '/store/order']);
  });

  test('falls back to appending a path when its recorded neighbor is also gone', () => {
    const spec = { paths: { '/store/order': { get: {} } } };
    const record = {
      path: '/pet/findByStatus',
      method: 'get',
      operation: { summary: 'list' },
      precedingPath: '/pet',
    };

    const restored = restoreOperation(spec, record);

    expect(Object.keys(restored.paths)).toEqual(['/store/order', '/pet/findByStatus']);
  });

  test('reinserts a method back at its original position within a surviving path item', () => {
    const spec = { paths: { '/pet': { get: {}, delete: {} } } };
    const record = {
      path: '/pet',
      method: 'post',
      operation: { summary: 'add' },
      precedingMethod: 'get',
    };

    const restored = restoreOperation(spec, record);

    expect(Object.keys(restored.paths['/pet'])).toEqual(['get', 'post', 'delete']);
  });

  test('reinserts a dropped tag back at its original position among siblings', () => {
    const spec = {
      tags: [{ name: 'pet' }, { name: 'user' }],
      paths: {},
    };
    const record = {
      path: '/store/order',
      method: 'post',
      operation: { tags: ['store'] },
      removedTags: [{ tag: { name: 'store' }, precedingTag: 'pet' }],
    };

    const restored = restoreOperation(spec, record);

    expect(restored.tags.map((tag) => tag.name)).toEqual(['pet', 'store', 'user']);
  });

  test('reinserts a tag at the front when it was originally first', () => {
    const spec = { tags: [{ name: 'store' }], paths: {} };
    const record = {
      path: '/pet',
      method: 'get',
      operation: { tags: ['pet'] },
      removedTags: [{ tag: { name: 'pet' }, precedingTag: null }],
    };

    const restored = restoreOperation(spec, record);

    expect(restored.tags.map((tag) => tag.name)).toEqual(['pet', 'store']);
  });

  test('falls back to appending a tag when its recorded neighbor is also gone', () => {
    const spec = { tags: [{ name: 'user' }], paths: {} };
    const record = {
      path: '/store/order',
      method: 'post',
      operation: { tags: ['store'] },
      removedTags: [{ tag: { name: 'store' }, precedingTag: 'pet' }],
    };

    const restored = restoreOperation(spec, record);

    expect(restored.tags.map((tag) => tag.name)).toEqual(['user', 'store']);
  });

  test('still restores a tag with no position info (plain tag object, no wrapper)', () => {
    const spec = { paths: {} };
    const record = {
      path: '/pet',
      method: 'get',
      operation: { tags: ['pet'] },
      removedTags: [{ name: 'pet' }],
    };

    const restored = restoreOperation(spec, record);

    expect(restored.tags).toEqual([{ name: 'pet' }]);
  });
});

describe('removeOperationFromContent / removeOperationsFromContent', () => {
  const YAML_SPEC = [
    'openapi: 3.0.0',
    'paths:',
    '  /pet:',
    '    post: {}',
    '  /pet/findByStatus:',
    '    get: {}',
  ].join('\n');

  test('removes the named operation and re-serializes matching the original format', () => {
    const result = removeOperationFromContent(YAML_SPEC, '/pet/findByStatus', 'get', true);

    expect(result).not.toBeNull();
    expect(result.content).not.toContain('findByStatus');
    expect(result.content).toContain('/pet:');
    expect(result.record).toMatchObject({ path: '/pet/findByStatus', method: 'get' });
  });

  test('serializes as JSON when isYAML is false', () => {
    const result = removeOperationFromContent(YAML_SPEC, '/pet/findByStatus', 'get', false);

    expect(() => JSON.parse(result.content)).not.toThrow();
    expect(result.content).not.toContain('findByStatus');
  });

  test('returns null when the content cannot be parsed', () => {
    expect(removeOperationFromContent('{ not: valid: yaml: [', '/pet', 'get', true)).toBeNull();
  });

  test('returns null when the named operation is already gone', () => {
    expect(removeOperationFromContent(YAML_SPEC, '/pet/missing', 'get', true)).toBeNull();
  });

  test('removeOperationsFromContent removes several operations in one pass', () => {
    const result = removeOperationsFromContent(
      YAML_SPEC,
      [
        { path: '/pet', method: 'post' },
        { path: '/pet/findByStatus', method: 'get' },
      ],
      true
    );

    expect(result.records).toHaveLength(2);
    expect(result.content).not.toContain('paths');
  });

  test('removeOperationsFromContent skips keys that are not in the spec, keeping the rest', () => {
    const result = removeOperationsFromContent(
      YAML_SPEC,
      [
        { path: '/pet', method: 'post' },
        { path: '/missing', method: 'get' },
      ],
      true
    );

    expect(result.records).toHaveLength(1);
  });

  test('removeOperationsFromContent returns null when nothing in keys is found', () => {
    expect(
      removeOperationsFromContent(YAML_SPEC, [{ path: '/missing', method: 'get' }], true)
    ).toBeNull();
  });
});

describe('restoreOperationInContent / restoreOperationsInContent', () => {
  const YAML_SPEC = ['openapi: 3.0.0', 'paths:', '  /pet:', '    post: {}'].join('\n');

  test('restores a single record into the current content', () => {
    const content = restoreOperationInContent(
      YAML_SPEC,
      { path: '/pet/findByStatus', method: 'get', operation: { summary: 'list' } },
      true
    );

    expect(content).toContain('findByStatus');
    expect(content).toContain('post:');
  });

  test('restores several records in one pass', () => {
    const content = restoreOperationsInContent(
      YAML_SPEC,
      [
        { path: '/pet/findByStatus', method: 'get', operation: {} },
        { path: '/store/order', method: 'post', operation: {} },
      ],
      true
    );

    expect(content).toContain('findByStatus');
    expect(content).toContain('/store/order');
  });

  test('returns null when the current content cannot be parsed', () => {
    expect(
      restoreOperationInContent('{ not: valid: yaml: [', { path: '/pet', method: 'get' }, true)
    ).toBeNull();
  });
});
