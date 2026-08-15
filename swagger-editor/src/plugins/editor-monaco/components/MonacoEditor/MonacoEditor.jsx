import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as monaco from 'monaco-editor';
import noop from 'lodash/noop.js';

import seVsDarkTheme from '../../themes/se-vs-dark.js';
import seVsLightTheme from '../../themes/se-vs-light.js';
import { useMount, useUpdate, useSmoothResize } from './hooks.js';

// Used as the model-map key whenever nothing (e.g. no tabs plugin) drives
// `documentId` -- keeps the single-shared-model behavior byte-for-byte
// identical to before per-document models existed.
const DEFAULT_DOCUMENT_ID = '__default__';

/**
 * Hooks in MonacoEditor component are divided into 4 categories:
 *  - hooks that are executed only on mount (useMount)
 *  - hooks that are executed on mount and when values change (useEffect)
 *  - hooks that are executed only when values change after the mount (useUpdate)
 *  - rest of the hooks
 */

const MonacoEditor = ({
  value,
  theme,
  language,
  documentId,
  disposeDocumentId,
  disposeDocumentRequestId,
  isReadOnly = false,
  bracketPairColorizationEnabled = false,
  onMount = noop,
  onWillUnmount = noop,
  onChange = noop,
  onEditorMarkersDidChange = noop,
}) => {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const subscriptionRef = useRef(null);
  const valueRef = useRef(value);
  const preventCreation = useRef(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  // documentId -> ITextModel. Each tab gets its own model (and therefore its
  // own independent undo/redo stack) the first time it's switched to; every
  // later switch back to that tab reuses the same model.
  const modelsRef = useRef(new Map());
  const activeDocumentIdRef = useRef(null);

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;
    if (preventCreation.current) return;

    const initialDocumentId = documentId ?? DEFAULT_DOCUMENT_ID;
    // Explicitly created (monaco.editor.createModel), not left for
    // monaco.editor.create() to synthesize implicitly from `value`/
    // `language` -- an editor's own implicitly-created default model gets
    // auto-disposed by Monaco as soon as a *different* model is attached via
    // setModel(), which would silently invalidate this tab's own model the
    // first time another tab is switched to.
    const initialModel = monaco.editor.createModel(value, language);

    editorRef.current = monaco.editor.create(containerRef.current, {
      model: initialModel,
      // semantic tokens provider is disabled by default; https://github.com/microsoft/monaco-editor/issues/1833
      'semanticHighlighting.enabled': true,
      theme,
      glyphMargin: true,
      lightbulb: {
        enabled: true,
      },
      lineNumbers: 'on',
      autoIndent: 'full',
      formatOnPaste: true,
      formatOnType: true,
      wordWrap: 'on',
      minimap: {
        enabled: true,
      },
      domReadOnly: isReadOnly,
      readOnly: isReadOnly,
      wordBasedSuggestions: false,
      quickSuggestions: true,
      quickSuggestionsDelay: 300,
      fixedOverflowWidgets: true,
      'bracketPairColorization.enabled': bracketPairColorizationEnabled,
      suggest: {
        snippetsPreventQuickSuggestions: false,
      },
      renderWhitespace: true,
      matchOnWordStartOnly: false,
    });

    initialModel.updateOptions({ tabSize: 2 });

    modelsRef.current.set(initialDocumentId, initialModel);
    activeDocumentIdRef.current = initialDocumentId;

    setIsEditorReady(true);
    preventCreation.current = true;
    // documentId intentionally excluded -- creation only ever runs once
    // (guarded by preventCreation), so re-running this callback identity on
    // documentId changes would be misleading; the *current* value is read
    // fresh at the one moment this function actually executes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, language, theme, isReadOnly, bracketPairColorizationEnabled]);

  const disposeEditor = useCallback(() => {
    onWillUnmount(editorRef.current, monaco);
    subscriptionRef.current?.dispose();
    modelsRef.current.forEach((model) => model.dispose());
    modelsRef.current.clear();
    editorRef.current.dispose();
  }, [onWillUnmount]);

  // disposing of Monaco Editor
  useMount(() => {
    return () => {
      if (editorRef.current) disposeEditor();
    };
  });

  // defining the custom themes and setting the active one
  useMount(() => {
    monaco.editor.defineTheme('se-vs-dark', seVsDarkTheme);
    monaco.editor.defineTheme('se-vs-light', seVsLightTheme);
  });

  // update language
  useUpdate(
    () => {
      monaco.editor.setModelLanguage(editorRef.current.getModel(), language);
    },
    [language],
    isEditorReady
  );

  // track model changes from outside of editor
  useUpdate(
    () => {
      valueRef.current = value;

      if (editorRef.current.getOption(monaco.editor.EditorOption.readOnly)) {
        editorRef.current.setValue(value);
        return;
      }

      const normalizedDocumentId = documentId ?? DEFAULT_DOCUMENT_ID;

      if (normalizedDocumentId !== activeDocumentIdRef.current) {
        // Switching to a different tab's own document: attach its own model
        // (creating one on first visit) instead of pushing content into the
        // current model, so each tab keeps its own independent undo/redo
        // stack rather than sharing one linear history across tabs.
        let model = modelsRef.current.get(normalizedDocumentId);
        if (!model) {
          model = monaco.editor.createModel(value, language);
          modelsRef.current.set(normalizedDocumentId, model);
        } else if (model.getValue() !== value) {
          // Defensive reconciliation only -- shouldn't normally happen,
          // since the model itself is the source of truth for a tab once
          // created.
          model.pushEditOperations(
            [],
            [{ range: model.getFullModelRange(), text: value }],
            () => null
          );
        }

        editorRef.current.setModel(model);
        activeDocumentIdRef.current = normalizedDocumentId;
        valueRef.current = model.getValue();

        // Monaco only fires onDidChangeMarkers when markers actually change,
        // not just because setModel() was called -- resync the Redux mirror
        // (ValidationPane/ValidationTable) explicitly so it reflects the
        // newly-attached tab's own markers immediately, not a stale copy of
        // the previous tab's.
        onEditorMarkersDidChange(monaco.editor.getModelMarkers({ resource: model.uri }));
      } else if (value !== editorRef.current.getValue()) {
        const model = editorRef.current.getModel();
        // Push as a tracked edit operation rather than disposing/recreating
        // the model (or calling model.setValue, which Monaco documents as
        // destroying the undo stack too) -- this is what lets Ctrl+Z step
        // back through a programmatic content replacement (Import URL,
        // Aggregate, Resolve document, etc.) instead of leaving nothing to
        // undo to.
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: value }],
          () => null
        );
      }
    },
    [value, documentId],
    isEditorReady
  );

  // dispose a closed tab's model once it's safely no longer attached
  useUpdate(
    () => {
      const normalizedDisposeId = disposeDocumentId ?? DEFAULT_DOCUMENT_ID;
      const model = modelsRef.current.get(normalizedDisposeId);

      if (model && normalizedDisposeId !== activeDocumentIdRef.current) {
        model.dispose();
        modelsRef.current.delete(normalizedDisposeId);
      }
    },
    [disposeDocumentRequestId],
    isEditorReady
  );

  // setting Monaco Editor to write/read mode
  useUpdate(
    () => {
      editorRef.current.updateOptions({ domReadOnly: isReadOnly, readOnly: isReadOnly });
    },
    [isReadOnly],
    isEditorReady
  );

  // settings the theme if changed
  useUpdate(
    () => {
      monaco.editor.setTheme(theme);
    },
    [theme],
    isEditorReady
  );

  // register listener for validation markers
  useEffect(() => {
    if (!isEditorReady) return undefined;

    const disposable = monaco.editor.onDidChangeMarkers((uris) => {
      const { uri: currentModelUri } = editorRef.current.getModel();
      const hasCurrentModelChanged = uris.find((uri) => String(uri) === String(currentModelUri));

      if (hasCurrentModelChanged) {
        const markers = monaco.editor.getModelMarkers({ resource: currentModelUri });
        onEditorMarkersDidChange(markers);
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [isEditorReady, onEditorMarkersDidChange]);

  // propagate changes from editor to handler
  useEffect(() => {
    if (isEditorReady) {
      subscriptionRef.current?.dispose();
      subscriptionRef.current = editorRef.current?.onDidChangeModelContent((event) => {
        const editorValue = editorRef.current.getValue();

        if (valueRef.current !== editorValue) {
          valueRef.current = editorValue;
          onChange(editorValue, event);
        }
      });
    }
  }, [isEditorReady, onChange]);

  // allow editor to resize to available space
  useEffect(() => {
    if (isEditorReady) {
      editorRef.current.layout();
    }
  }, [isEditorReady]);

  // notify listeners that Monaco Editor instance has been created
  useEffect(() => {
    if (isEditorReady) {
      onMount(editorRef.current);
    }
  }, [isEditorReady, onMount]);

  // creating Editor instance as last effect
  useEffect(() => {
    if (!isEditorReady) {
      createEditor();
    }
  }, [isEditorReady, createEditor]);

  // handle smooth resizing of Monaco Editor
  useSmoothResize({ eventName: 'editorcontainerresize', editorRef });

  return <div ref={containerRef} className="swagger-editor__editor-monaco" />;
};

MonacoEditor.propTypes = {
  value: PropTypes.string.isRequired,
  language: PropTypes.string.isRequired,
  theme: PropTypes.string.isRequired,
  documentId: PropTypes.string,
  disposeDocumentId: PropTypes.string,
  disposeDocumentRequestId: PropTypes.string,
  isReadOnly: PropTypes.bool,
  bracketPairColorizationEnabled: PropTypes.bool,
  onMount: PropTypes.func,
  onWillUnmount: PropTypes.func,
  onChange: PropTypes.func,
  onEditorMarkersDidChange: PropTypes.func,
};

export default MonacoEditor;
