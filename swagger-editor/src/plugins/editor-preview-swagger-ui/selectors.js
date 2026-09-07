import { List } from 'immutable';

export const selectURL = (state) => state.get('url') || '';

// The operations removed from `tabId`'s spec via a checkbox (or a tag's
// "Remove all"), most-recently-removed last -- the basis for the Preview
// pane's "restore" affordances. Returns a plain array (not an Immutable
// List) since nothing downstream needs it to be one.
export const selectRemovedOperations = (state, tabId) =>
  state.getIn(['removedOperations', tabId], List()).toArray();
