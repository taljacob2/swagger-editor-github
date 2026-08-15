import { Map } from 'immutable';

import { EDITOR_DISPOSE_DOCUMENT, disposeDocument } from './dispose-document.js';
import reducers from '../reducers.js';

// Note: deliberately not importing from '../selectors.js' here -- it also
// exports selectEditor(), which imports the real 'monaco-editor' package and
// pulls in .css files that plain vitest (outside the app's Vite pipeline)
// can't load. Asserting against the reducer's own Immutable state directly
// keeps this test scoped to action/reducer behavior.
describe('disposeDocument', () => {
  test('creates a flux-standard action carrying the document id and a nonce requestId', () => {
    const action = disposeDocument('tab-1');

    expect(action.type).toBe(EDITOR_DISPOSE_DOCUMENT);
    expect(action.payload.documentId).toBe('tab-1');
    expect(action.payload.requestId).toEqual(expect.any(String));
  });

  test('two calls for the same document produce different requestIds (so the same tab can be disposed twice)', () => {
    const first = disposeDocument('tab-1');
    const second = disposeDocument('tab-1');

    expect(first.payload.requestId).not.toBe(second.payload.requestId);
  });

  test('the reducer stores documentId and requestId together under disposeDocumentRequest', () => {
    const action = disposeDocument('tab-1');
    const nextState = reducers[EDITOR_DISPOSE_DOCUMENT](Map(), action);

    expect(nextState.getIn(['disposeDocumentRequest', 'documentId'])).toBe('tab-1');
    expect(nextState.getIn(['disposeDocumentRequest', 'requestId'])).toBe(action.payload.requestId);
  });
});
