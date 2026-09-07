import { restoreOperationsInContent } from '../operation-filter-service.js';

export const OPERATION_REMOVALS_RECORDED = 'editor_preview_swagger_ui_operation_removals_recorded';
export const OPERATION_REMOVALS_FORGOTTEN =
  'editor_preview_swagger_ui_operation_removals_forgotten';

// `records` is always an array, even for a single checkbox's removal --
// keeps the reducer (and a bulk, per-tag removal) to one code path.
export const recordOperationRemovals = ({ tabId, records }) => ({
  type: OPERATION_REMOVALS_RECORDED,
  payload: { tabId, records },
});

export const forgetOperationRemovals = ({ tabId, keys }) => ({
  type: OPERATION_REMOVALS_FORGOTTEN,
  payload: { tabId, keys },
});

// Restores every given record for `tabId` in a single editor-content
// rewrite, then drops them from that tab's removed-operations history. A
// no-op on an empty list, so call sites don't need to guard first.
export const restoreOperations = (tabId, records) => async (system) => {
  if (records.length === 0) {
    return;
  }
  const { editorSelectors, editorActions, EditorContentOrigin, editorPreviewSwaggerUIActions } =
    system;
  const content = editorSelectors.selectContent();
  const isYAML = editorSelectors.selectIsContentFormatYAML();
  const nextContent = restoreOperationsInContent(content, records, isYAML);
  if (nextContent !== null) {
    editorActions.setContent(nextContent, EditorContentOrigin.EndpointFilter);
    editorPreviewSwaggerUIActions.forgetOperationRemovals({
      tabId,
      keys: records.map((record) => ({ path: record.path, method: record.method })),
    });
  }
};
