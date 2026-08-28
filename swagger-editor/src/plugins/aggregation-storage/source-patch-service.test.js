import { applySourcePatch } from './source-patch-service.js';

describe('applySourcePatch', () => {
  test('edits a field while leaving a comment on an untouched sibling line intact', () => {
    const text = 'info:\n  title: X # keep me\n  version: "1.0.0"\n';

    const result = applySourcePatch(text, [{ subPath: ['info', 'version'], value: '2.0.0' }]);

    // The edited scalar keeps its own original quote style too (mutated in
    // place, not replaced with a fresh default-styled node) -- a bonus on
    // top of the sibling comment surviving untouched.
    expect(result).toBe('info:\n  title: X # keep me\n  version: "2.0.0"\n');
  });

  test('preserves an inline comment on the very line being edited', () => {
    const text = 'info:\n  title: X # keep me\n';

    const result = applySourcePatch(text, [{ subPath: ['info', 'title'], value: 'Y' }]);

    expect(result).toBe('info:\n  title: Y # keep me\n');
  });

  test('editing an anchored node propagates to every alias site automatically', () => {
    const text = 'components:\n  schemas:\n    User: &user\n      type: object\n    Admin: *user\n';

    const result = applySourcePatch(text, [
      { subPath: ['components', 'schemas', 'User', 'type'], value: 'string' },
    ]);

    expect(result).toBe(
      'components:\n  schemas:\n    User: &user\n      type: string\n    Admin: *user\n'
    );
  });

  test('adds a new field within an existing entry', () => {
    const text = 'paths:\n  /users:\n    get:\n      summary: List users\n';

    const result = applySourcePatch(text, [
      { subPath: ['paths', '/users', 'get', 'operationId'], value: 'listUsers' },
    ]);

    expect(result).toBe(
      'paths:\n  /users:\n    get:\n      summary: List users\n      operationId: listUsers\n'
    );
  });

  test('deletes an existing field', () => {
    const text = 'info:\n  title: X\n  version: "1.0.0"\n';

    const result = applySourcePatch(text, [{ subPath: ['info', 'version'], isDelete: true }]);

    expect(result).toBe('info:\n  title: X\n');
  });

  test('throws when deleting a field that is already gone', () => {
    const text = 'info:\n  title: X\n';

    expect(() =>
      applySourcePatch(text, [{ subPath: ['info', 'version'], isDelete: true }])
    ).toThrow(/version/);
  });

  test('throws when an intermediate path segment is a scalar, not a collection', () => {
    const text = 'info:\n  title: X\n';

    expect(() =>
      applySourcePatch(text, [{ subPath: ['info', 'title', 'nested'], value: 'Y' }])
    ).toThrow();
  });

  test('replaces a changed flow-style array while keeping it flow-style', () => {
    const text = 'paths:\n  /users:\n    get:\n      tags: [Users, Admin]\n';

    const result = applySourcePatch(text, [
      { subPath: ['paths', '/users', 'get', 'tags'], value: ['Users', 'Admin', 'Public'] },
    ]);

    expect(result).toBe('paths:\n  /users:\n    get:\n      tags: [ Users, Admin, Public ]\n');
  });

  test('replaces a changed block-style array while keeping it block-style', () => {
    const text = 'paths:\n  /users:\n    get:\n      tags:\n        - Users\n        - Admin\n';

    const result = applySourcePatch(text, [
      { subPath: ['paths', '/users', 'get', 'tags'], value: ['Users', 'Admin', 'Public'] },
    ]);

    expect(result).toBe(
      'paths:\n  /users:\n    get:\n      tags:\n        - Users\n        - Admin\n        - Public\n'
    );
  });

  test('applies multiple ops across different entries in one pass', () => {
    const text = 'paths:\n  /a:\n    get:\n      summary: A\n  /b:\n    get:\n      summary: B\n';

    const result = applySourcePatch(text, [
      { subPath: ['paths', '/a', 'get', 'summary'], value: 'A2' },
      { subPath: ['paths', '/b', 'get', 'summary'], value: 'B2' },
    ]);

    expect(result).toBe(
      'paths:\n  /a:\n    get:\n      summary: A2\n  /b:\n    get:\n      summary: B2\n'
    );
  });

  test('works against a JSON source file, not just YAML', () => {
    const text = '{\n  "info": {\n    "title": "X"\n  }\n}';

    const result = applySourcePatch(text, [{ subPath: ['info', 'title'], value: 'Y' }]);

    expect(JSON.parse(result)).toEqual({ info: { title: 'Y' } });
  });
});
