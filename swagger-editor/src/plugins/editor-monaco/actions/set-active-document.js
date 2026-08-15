export const EDITOR_SET_ACTIVE_DOCUMENT = 'editor_set_active_document';

export const setActiveDocument = (documentId) => {
  return {
    payload: documentId,
    type: EDITOR_SET_ACTIVE_DOCUMENT,
  };
};
