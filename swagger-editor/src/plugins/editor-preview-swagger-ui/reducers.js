import { List } from 'immutable';

import { EDITOR_IMPORT_URL_SUCCESS } from '../top-bar/actions/import-url.js';
import {
  OPERATION_REMOVALS_RECORDED,
  OPERATION_REMOVALS_FORGOTTEN,
} from './actions/operation-removal.js';

const removalKey = (record) => `${record.method} ${record.path}`;

const reducers = {
  [EDITOR_IMPORT_URL_SUCCESS]: (state, action) => {
    return state.set('url', action.meta.url);
  },
  [OPERATION_REMOVALS_RECORDED]: (state, action) => {
    const { tabId, records } = action.payload;
    const existing = state.getIn(['removedOperations', tabId], List());
    return state.setIn(['removedOperations', tabId], existing.push(...records));
  },
  [OPERATION_REMOVALS_FORGOTTEN]: (state, action) => {
    const { tabId, keys } = action.payload;
    const forgottenKeys = new Set(keys.map((key) => `${key.method} ${key.path}`));
    const existing = state.getIn(['removedOperations', tabId], List());
    return state.setIn(
      ['removedOperations', tabId],
      existing.filter((record) => !forgottenKeys.has(removalKey(record)))
    );
  },
};

export default reducers;
