import { isCollection, isScalar, parseDocument } from 'yaml';

// Same JSON-vs-YAML sniff suggest-pr-service.js's caller already uses
// (looksLikeJson in SuggestPrModal.jsx) -- an extension-agnostic check on
// the content itself, since a source's path alone isn't always trustworthy
// (nothing stops a JSON file from being named openapi.yaml). Only used here
// to pick toString()'s defaults for a *newly created* node (see below);
// existing content's own style is never touched by this check.
function looksLikeJson(rawSourceText) {
  return /^\s*[[{]/.test(rawSourceText);
}

function isPrimitiveValue(value) {
  return value === null || typeof value !== 'object';
}

// Mutates the existing node in place whenever the replacement is a like-for-
// like primitive -- setIn(path, doc.createNode(value)) would work too, but
// a *new* node carries none of the old one's comment or quote style
// (`"x"` vs `'x'` vs bare `x`), and createNode's own defaults don't match a
// JSON document's requirement that every string stay quoted. Reusing the
// node sidesteps both: same object, same comment, same quote style.
// Falls back to a fresh node for anything shape-changing (scalar <-> object/
// array, or the field not existing yet), carrying over the old node's own
// flow-vs-block style when it was itself a collection -- createNode alone
// always defaults to block, which would needlessly reformat e.g. a
// short `tags: [a, b]` into a multi-line list.
function applyValue(doc, subPath, value) {
  const existingNode = doc.getIn(subPath, true);
  if (isScalar(existingNode) && isPrimitiveValue(value)) {
    existingNode.value = value;
    return;
  }

  const node = doc.createNode(value);
  if (isCollection(existingNode) && isCollection(node)) {
    node.flow = existingNode.flow;
  }
  doc.setIn(subPath, node);
}

// Applies a set of field-level edits to a raw YAML/JSON source file's text
// via the `yaml` package's CST-based Document API, which -- unlike js-yaml's
// parse/dump round trip used everywhere else in this app -- preserves
// comments and anchors/aliases it doesn't touch. See the Phase 2 spec's
// spike results for what's actually preserved vs. not (comment spacing on
// an *untouched* line can get cosmetically renormalized; nothing else).
//
// ops: [{ subPath: [...], value, isDelete }] -- subPath is the *full* path
// from this document's root (e.g. ['paths', '/users', 'get', 'summary']),
// already resolved by the caller; this function has no notion of "entry"
// vs. "field" itself.
//
// Throws if any op's subPath doesn't resolve cleanly against this document
// -- an intermediate segment that's a scalar instead of a map/sequence, or a
// delete whose target is already gone. That's expected to be caught by a
// per-source drift check *before* this is ever called (the source, fetched
// fresh, should still match the baseline the ops were computed against),
// not handled again here.
// eslint-disable-next-line import/prefer-default-export
export function applySourcePatch(rawSourceText, ops) {
  const doc = parseDocument(rawSourceText);

  ops.forEach(({ subPath, value, isDelete }) => {
    if (isDelete) {
      if (!doc.deleteIn(subPath)) {
        throw new Error(
          `Couldn't find ${subPath.join('.')} to delete -- it may have changed upstream.`
        );
      }
      return;
    }
    applyValue(doc, subPath, value);
  });

  return doc.toString(
    looksLikeJson(rawSourceText)
      ? { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'QUOTE_DOUBLE' }
      : undefined
  );
}
