import {
  MAX_HISTORY_ENTRIES,
  computeOperations,
  createEmptyHistory,
  getHistory,
  popFuture,
  popPast,
  pushPast,
  removeHistory,
  saveHistory,
  toForwardEdits,
  toInverseEdits,
} from './undo-history.js';

// Mirrors how these edits would actually be applied to a Monaco model:
// sequentially, using each edit's own (unadjusted) rangeOffset. Valid only
// because edits within one batch are end-to-beginning ordered and
// non-overlapping, exactly as Monaco documents its own change events.
function applyEditsToString(content, edits) {
  return edits.reduce(
    (acc, { rangeOffset, rangeLength, text }) =>
      acc.slice(0, rangeOffset) + text + acc.slice(rangeOffset + rangeLength),
    content
  );
}

describe('undo-history', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('computeOperations', () => {
    test('a simple insert', () => {
      const ops = computeOperations([{ rangeOffset: 1, rangeLength: 0, text: 'X' }], 'abc');

      expect(ops).toEqual([{ rangeOffset: 1, removedText: '', insertedText: 'X' }]);
    });

    test('a simple delete', () => {
      const ops = computeOperations([{ rangeOffset: 1, rangeLength: 1, text: '' }], 'abcd');

      expect(ops).toEqual([{ rangeOffset: 1, removedText: 'b', insertedText: '' }]);
    });

    test('a replace', () => {
      const ops = computeOperations(
        [{ rangeOffset: 6, rangeLength: 5, text: 'there' }],
        'hello world'
      );

      expect(ops).toEqual([{ rangeOffset: 6, removedText: 'world', insertedText: 'there' }]);
    });

    test('multiple changes from one event (e.g. multi-cursor), order preserved', () => {
      const ops = computeOperations(
        [
          { rangeOffset: 3, rangeLength: 1, text: 'Y' },
          { rangeOffset: 1, rangeLength: 1, text: 'Y' },
        ],
        'aXbXc'
      );

      expect(ops).toEqual([
        { rangeOffset: 3, removedText: 'X', insertedText: 'Y' },
        { rangeOffset: 1, removedText: 'X', insertedText: 'Y' },
      ]);
    });
  });

  describe('toForwardEdits / toInverseEdits', () => {
    const operations = [{ rangeOffset: 6, removedText: 'world', insertedText: 'there' }];

    test('toForwardEdits replays the original edit', () => {
      expect(toForwardEdits(operations)).toEqual([
        { rangeOffset: 6, rangeLength: 5, text: 'there' },
      ]);
    });

    test('toInverseEdits reverses it', () => {
      expect(toInverseEdits(operations)).toEqual([
        { rangeOffset: 6, rangeLength: 5, text: 'world' },
      ]);
    });
  });

  describe('forward + inverse round-trip against real strings', () => {
    test('a single edit restores the original string via its inverse', () => {
      const original = 'hello world';
      const changes = [{ rangeOffset: 6, rangeLength: 5, text: 'there' }];
      const operations = computeOperations(changes, original);

      const edited = applyEditsToString(original, toForwardEdits(operations));
      expect(edited).toBe('hello there');

      const restored = applyEditsToString(edited, toInverseEdits(operations));
      expect(restored).toBe(original);
    });

    test('a multi-change event (multi-cursor) restores correctly via its inverse', () => {
      const original = 'aXbXc';
      const changes = [
        { rangeOffset: 3, rangeLength: 1, text: 'Y' },
        { rangeOffset: 1, rangeLength: 1, text: 'Y' },
      ];
      const operations = computeOperations(changes, original);

      const edited = applyEditsToString(original, toForwardEdits(operations));
      expect(edited).toBe('aYbYc');

      const restored = applyEditsToString(edited, toInverseEdits(operations));
      expect(restored).toBe(original);
    });

    test('two sequential edits undo back to the original in reverse order', () => {
      const original = 'openapi: 3.0.0';

      const changes1 = [{ rangeOffset: 14, rangeLength: 0, text: '\ninfo:' }];
      const ops1 = computeOperations(changes1, original);
      const afterEdit1 = applyEditsToString(original, toForwardEdits(ops1));
      expect(afterEdit1).toBe('openapi: 3.0.0\ninfo:');

      const changes2 = [{ rangeOffset: 9, rangeLength: 5, text: '1.0' }];
      const ops2 = computeOperations(changes2, afterEdit1);
      const afterEdit2 = applyEditsToString(afterEdit1, toForwardEdits(ops2));
      expect(afterEdit2).toBe('openapi: 1.0\ninfo:');

      const undoneEdit2 = applyEditsToString(afterEdit2, toInverseEdits(ops2));
      expect(undoneEdit2).toBe(afterEdit1);

      const undoneEdit1 = applyEditsToString(undoneEdit2, toInverseEdits(ops1));
      expect(undoneEdit1).toBe(original);
    });
  });

  describe('pushPast / popPast / popFuture', () => {
    test('pushPast appends and clears future', () => {
      const withFuture = { past: [], future: [['stale']] };
      const next = pushPast(withFuture, ['op-a']);

      expect(next).toEqual({ past: [['op-a']], future: [] });
    });

    test('pushPast evicts the oldest entry once past MAX_HISTORY_ENTRIES', () => {
      const past = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => [`op-${i}`]);
      const history = { past, future: [] };

      const next = pushPast(history, ['op-new']);

      expect(next.past).toHaveLength(MAX_HISTORY_ENTRIES);
      expect(next.past[0]).toEqual(['op-1']); // op-0 evicted
      expect(next.past[next.past.length - 1]).toEqual(['op-new']);
    });

    test('popPast returns null when past is empty', () => {
      expect(popPast(createEmptyHistory())).toBeNull();
    });

    test('popFuture returns null when future is empty', () => {
      expect(popFuture(createEmptyHistory())).toBeNull();
    });

    test('popPast moves the last past entry to future', () => {
      const history = { past: [['op-a'], ['op-b']], future: [] };

      const result = popPast(history);

      expect(result.operations).toEqual(['op-b']);
      expect(result.history).toEqual({ past: [['op-a']], future: [['op-b']] });
    });

    test('popFuture moves the last future entry back to past', () => {
      const history = { past: [['op-a']], future: [['op-b']] };

      const result = popFuture(history);

      expect(result.operations).toEqual(['op-b']);
      expect(result.history).toEqual({ past: [['op-a'], ['op-b']], future: [] });
    });

    test('undo then redo then undo round-trips through the same operations', () => {
      let history = createEmptyHistory();
      history = pushPast(history, ['op-a']);
      history = pushPast(history, ['op-b']);

      const undo1 = popPast(history);
      history = undo1.history;
      expect(undo1.operations).toEqual(['op-b']);

      const redo1 = popFuture(history);
      history = redo1.history;
      expect(redo1.operations).toEqual(['op-b']);

      const undo2 = popPast(history);
      expect(undo2.operations).toEqual(['op-b']);
      const undo3 = popPast(undo2.history);
      expect(undo3.operations).toEqual(['op-a']);
      expect(popPast(undo3.history)).toBeNull();
    });
  });

  describe('getHistory / saveHistory / removeHistory', () => {
    test('getHistory defaults to empty when nothing is stored', () => {
      expect(getHistory('tab-1')).toEqual(createEmptyHistory());
    });

    test('getHistory falls back to empty on corrupt JSON', () => {
      localStorage.setItem('editor-monaco:undo-history:tab-1', 'not json');

      expect(getHistory('tab-1')).toEqual(createEmptyHistory());
    });

    test('saveHistory then getHistory round-trips', () => {
      const history = {
        past: [[{ rangeOffset: 0, removedText: '', insertedText: 'x' }]],
        future: [],
      };

      saveHistory('tab-1', history);

      expect(getHistory('tab-1')).toEqual(history);
    });

    test("saving one tab does not affect another tab's history", () => {
      saveHistory('tab-1', { past: [['a']], future: [] });
      saveHistory('tab-2', { past: [['b']], future: [] });

      expect(getHistory('tab-1')).toEqual({ past: [['a']], future: [] });
      expect(getHistory('tab-2')).toEqual({ past: [['b']], future: [] });
    });

    test("removeHistory clears only that tab's history", () => {
      saveHistory('tab-1', { past: [['a']], future: [] });
      saveHistory('tab-2', { past: [['b']], future: [] });

      removeHistory('tab-1');

      expect(getHistory('tab-1')).toEqual(createEmptyHistory());
      expect(getHistory('tab-2')).toEqual({ past: [['b']], future: [] });
    });
  });
});
