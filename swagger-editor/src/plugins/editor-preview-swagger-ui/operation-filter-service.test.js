import {
  buildSubsetSpec,
  listOperations,
  operationKey,
  parseSpecContent,
  removeOperationFromContent,
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
      { key: 'PUT /pet', path: '/pet', method: 'put' },
      { key: 'POST /pet', path: '/pet', method: 'post' },
      { key: 'GET /pet/{petId}', path: '/pet/{petId}', method: 'get' },
    ]);
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

    expect(listOperations(spec)).toEqual([{ key: 'GET /pet', path: '/pet', method: 'get' }]);
  });

  test('returns an empty list for a spec with no paths', () => {
    expect(listOperations({})).toEqual([]);
    expect(listOperations(undefined)).toEqual([]);
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

describe('removeOperationFromContent', () => {
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
    expect(result).not.toContain('findByStatus');
    expect(result).toContain('/pet:');
  });

  test('serializes as JSON when isYAML is false', () => {
    const result = removeOperationFromContent(YAML_SPEC, '/pet/findByStatus', 'get', false);

    expect(() => JSON.parse(result)).not.toThrow();
    expect(result).not.toContain('findByStatus');
  });

  test('returns null when the content cannot be parsed', () => {
    expect(removeOperationFromContent('{ not: valid: yaml: [', '/pet', 'get', true)).toBeNull();
  });

  test('returns null when the named operation is already gone', () => {
    expect(removeOperationFromContent(YAML_SPEC, '/pet/missing', 'get', true)).toBeNull();
  });
});
