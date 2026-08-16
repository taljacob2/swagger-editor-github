import YAML from 'js-yaml';

// @swagger-api/apidom-parser-adapter-yaml-1-2 hardcodes these two strings for every YAML syntax
// error it finds (see its syntactic-analysis/*/index.*js) -- there is no way to get a more useful
// reason out of that adapter directly. When we see one, we re-parse with js-yaml purely to recover
// a human-readable reason for display; its own error range/position is left untouched.
const GENERIC_YAML_SYNTAX_MESSAGES = new Set([
  '(Error YAML syntax error)',
  '(Unexpected YAML syntax error)',
]);

export function isGenericYamlSyntaxMessage(message) {
  return GENERIC_YAML_SYNTAX_MESSAGES.has(message);
}

export function describeYamlSyntaxError(text) {
  try {
    YAML.load(text);
    return null;
  } catch (error) {
    return error instanceof YAML.YAMLException ? error.reason : null;
  }
}
