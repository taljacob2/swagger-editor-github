import { describe, expect, test } from 'vitest';

import { describeYamlSyntaxError, isGenericYamlSyntaxMessage } from './yaml-syntax-error.js';

describe('isGenericYamlSyntaxMessage', () => {
  test('recognizes both of apidom-ls YAML adapter generic messages', () => {
    expect(isGenericYamlSyntaxMessage('(Error YAML syntax error)')).toBe(true);
    expect(isGenericYamlSyntaxMessage('(Unexpected YAML syntax error)')).toBe(true);
  });

  test('rejects unrelated messages', () => {
    expect(isGenericYamlSyntaxMessage('operationId must be unique')).toBe(false);
    expect(isGenericYamlSyntaxMessage('')).toBe(false);
  });
});

describe('describeYamlSyntaxError', () => {
  test('returns the underlying reason for an unterminated quoted scalar', () => {
    const text = 'openapi: 3.0.0\ninfo:\n  title: Broken\n  version: "1.0\npaths: {}\n';

    expect(describeYamlSyntaxError(text)).toBe(
      'unexpected end of the stream within a double quoted scalar'
    );
  });

  test('returns the underlying reason for a duplicate mapping key', () => {
    const text = 'openapi: 3.0.0\nopenapi: 3.0.0\n';

    expect(describeYamlSyntaxError(text)).toBe('duplicated mapping key');
  });

  test('returns null for valid YAML', () => {
    expect(describeYamlSyntaxError('openapi: 3.0.0\n')).toBeNull();
  });
});
