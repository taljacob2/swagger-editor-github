import { languages as vscodeLanguages } from 'vscode';
import { createConverter as createCodeConverter } from 'vscode-languageclient/lib/common/codeConverter.js';
import { createConverter as createProtocolConverter } from 'vscode-languageclient/lib/common/protocolConverter.js';

import {
  getCachedConnectionSettingsForWorkers,
  getConnectionSettings,
  setCachedConnectionSettingsForWorkers,
} from '../../github-connection/github-connection-service.js';
import WorkerManager from './WorkerManager.js';
import DiagnosticsProvider from './providers/DiagnosticsProvider.js';
import HoverProvider from './providers/HoverProvider.js';
import DocumentLinkProvider from './providers/DocumentLinkProvider.js';
import CompletionItemProvider from './providers/CompletionItemProvider.js';
import DocumentSemanticTokensProvider from './providers/DocumentSemanticTokensProvider.js';
import CodeActionsProvider from './providers/CodeActionsProvider.js';
import DocumentSymbolProvider from './providers/DocumentSymbolProvider.js';
import DefinitionProvider from './providers/DefinitionProvider.js';

let apidomWorker;

const disposeAll = (disposables) => {
  while (disposables.length) {
    disposables.pop().dispose();
  }
};

const asDisposable = (disposables) => {
  return { dispose: () => disposeAll(disposables) };
};

export const getWorker = () => {
  if (!apidomWorker) {
    throw new Error('ApiDOM not registered');
  }
  return apidomWorker;
};

const registerProviders = ({
  languageId,
  providers,
  dependencies,
  opts: { useApiDOMSyntaxHighlighting } = {},
}) => {
  disposeAll(providers);

  const { worker, codeConverter, protocolConverter, getSystem } = dependencies;
  const args = [worker, codeConverter, protocolConverter];
  const system = getSystem();

  /**
   * Customized providers needs to be registered before monaco editor is created.
   */
  providers.push(new DiagnosticsProvider(...args, getSystem));

  (async () => {
    await system.monacoInitializationDeferred().promise;

    providers.push(vscodeLanguages.registerHoverProvider(languageId, new HoverProvider(...args)));
    providers.push(
      vscodeLanguages.registerDocumentLinkProvider(languageId, new DocumentLinkProvider(...args))
    );
    providers.push(
      vscodeLanguages.registerCompletionItemProvider(
        languageId,
        new CompletionItemProvider(...args)
      )
    );
    providers.push(
      vscodeLanguages.registerCodeActionsProvider(languageId, new CodeActionsProvider(...args))
    );
    providers.push(
      vscodeLanguages.registerDocumentSymbolProvider(
        languageId,
        new DocumentSymbolProvider(...args)
      )
    );
    providers.push(
      vscodeLanguages.registerDefinitionProvider(languageId, new DefinitionProvider(...args))
    );

    if (useApiDOMSyntaxHighlighting) {
      const workerService = await worker();
      const semanticTokensLegend = await workerService.getSemanticTokensLegend();
      providers.push(
        vscodeLanguages.registerDocumentSemanticTokensProvider(
          languageId,
          new DocumentSemanticTokensProvider(...args),
          semanticTokensLegend
        )
      );
    }
  })();

  return providers;
};

export function setupMode(defaults, { useApiDOMSyntaxHighlighting } = {}) {
  const disposables = [];
  const providers = [];
  const codeConverter = createCodeConverter();
  const protocolConverter = createProtocolConverter(undefined, true, true);

  // setup ApiDOM worker
  const client = new WorkerManager(defaults);

  // Every caller of the worker (dereference, validation, hover, go-to-
  // definition, ...) goes through this one function, so it's the single
  // place to keep the worker's GitHub credentials current -- see
  // ApiDOMWorker#setConnectionSettings and github-resolver.js for why a
  // $ref to a private repo needs this at all. Reference-equality against
  // the last-pushed settings keeps this a no-op on every keystroke once
  // nothing has changed, instead of re-pushing (and re-configuring the
  // language service) on every single validation pass.
  let lastPushedConnectionSettings;
  const worker = async (...uris) => {
    const workerService = await client.getLanguageServiceWorker(...uris);

    let settings = getCachedConnectionSettingsForWorkers();
    if (!settings) {
      settings = await getConnectionSettings();
      setCachedConnectionSettingsForWorkers(settings);
    }

    if (settings !== lastPushedConnectionSettings) {
      lastPushedConnectionSettings = settings;
      const token = settings.fetchToken || settings.token;
      // Best-effort: a failure here shouldn't block returning the worker
      // for whatever the actual call (doHover, doValidation, ...) needs.
      workerService.setConnectionSettings(settings.apiBaseUrl, token).catch(() => {});
    }

    return workerService;
  };
  apidomWorker = worker;
  disposables.push({
    dispose() {
      apidomWorker = null;
    },
  });
  disposables.push(client);

  /**
   * Register ApiDOM providers.
   * We're already assuming here that extensions have
   * been successfully initialized.
   */
  disposables.push(
    asDisposable(
      registerProviders({
        languageId: defaults.getLanguageId(),
        providers,
        dependencies: {
          worker,
          codeConverter,
          protocolConverter,
          getSystem: defaults.getModeConfiguration().getSystem,
        },
        opts: { useApiDOMSyntaxHighlighting },
      })
    )
  );

  return asDisposable(disposables);
}
