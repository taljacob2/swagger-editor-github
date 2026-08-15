const STORAGE_KEY_PREFIX = 'editor-monaco:undo-history:';

// Oldest entries evicted first once a tab's past (or future) exceeds this --
// keeps a long editing session from growing localStorage without bound.
export const MAX_HISTORY_ENTRIES = 100;

export function createEmptyHistory() {
  return { past: [], future: [] };
}

// Given Monaco's raw onDidChangeModelContent event.changes and the content
// string as it was immediately *before* this event, returns one operation
// per change: {rangeOffset, removedText, insertedText}. removedText is
// sliced from `previousContent` ourselves, since Monaco's event only tells
// us the new text, not what was replaced. Order is preserved from the input
// (Monaco documents its changes as ordered end-to-beginning specifically so
// each rangeOffset is valid on its own, without cross-adjusting for sibling
// changes in the same event).
export function computeOperations(changes, previousContent) {
  return changes.map(({ rangeOffset, rangeLength, text }) => ({
    rangeOffset,
    removedText: previousContent.slice(rangeOffset, rangeOffset + rangeLength),
    insertedText: text,
  }));
}

// Replays operations exactly as they were first applied (redo).
export function toForwardEdits(operations) {
  return operations.map(({ rangeOffset, removedText, insertedText }) => ({
    rangeOffset,
    rangeLength: removedText.length,
    text: insertedText,
  }));
}

// Reverses operations, replacing each one's inserted text back with what was
// removed (undo).
export function toInverseEdits(operations) {
  return operations.map(({ rangeOffset, removedText, insertedText }) => ({
    rangeOffset,
    rangeLength: insertedText.length,
    text: removedText,
  }));
}

export function pushPast(history, operations) {
  const past = [...history.past, operations].slice(-MAX_HISTORY_ENTRIES);
  return { past, future: [] };
}

export function popPast(history) {
  if (history.past.length === 0) {
    return null;
  }
  const operations = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  const future = [...history.future, operations].slice(-MAX_HISTORY_ENTRIES);
  return { history: { past, future }, operations };
}

export function popFuture(history) {
  if (history.future.length === 0) {
    return null;
  }
  const operations = history.future[history.future.length - 1];
  const future = history.future.slice(0, -1);
  const past = [...history.past, operations].slice(-MAX_HISTORY_ENTRIES);
  return { history: { past, future }, operations };
}

function storageKey(documentId) {
  return `${STORAGE_KEY_PREFIX}${documentId}`;
}

export function getHistory(documentId) {
  try {
    const raw = localStorage.getItem(storageKey(documentId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
        return parsed;
      }
    }
  } catch {
    // fall through to default below
  }
  return createEmptyHistory();
}

export function saveHistory(documentId, history) {
  localStorage.setItem(storageKey(documentId), JSON.stringify(history));
}

export function removeHistory(documentId) {
  localStorage.removeItem(storageKey(documentId));
}
