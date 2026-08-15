export const EDITOR_DISPOSE_DOCUMENT = 'editor_dispose_document';

function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Carries a nonce alongside documentId so the reducer value always changes,
// even if the same document is ever disposed twice in a row -- MonacoEditor
// watches this value to know when to actually dispose a tab's model.
export const disposeDocument = (documentId) => {
  return {
    payload: { documentId, requestId: generateRequestId() },
    type: EDITOR_DISPOSE_DOCUMENT,
  };
};
