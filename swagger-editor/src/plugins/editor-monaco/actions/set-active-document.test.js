import { Map } from 'immutable';

import { EDITOR_SET_ACTIVE_DOCUMENT, setActiveDocument } from './set-active-document.js';
import reducers from '../reducers.js';

// Note: deliberately not importing from '../selectors.js' here -- it also
// exports selectEditor(), which imports the real 'monaco-editor' package and
// pulls in .css files that plain vitest (outside the app's Vite pipeline)
// can't load. Asserting against the reducer's own Immutable state directly
// keeps this test scoped to action/reducer behavior.
describe('setActiveDocument', () => {
  test('creates a flux-standard action carrying the document id', () => {
    expect(setActiveDocument('tab-1')).toEqual({
      type: EDITOR_SET_ACTIVE_DOCUMENT,
      payload: 'tab-1',
    });
  });

  test('the reducer stores it as activeDocumentId', () => {
    const nextState = reducers[EDITOR_SET_ACTIVE_DOCUMENT](Map(), setActiveDocument('tab-1'));

    expect(nextState.get('activeDocumentId')).toBe('tab-1');
  });
});
