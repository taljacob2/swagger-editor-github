import React from 'react';
import PropTypes from 'prop-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import SuggestAggregatedPrsModal from './SuggestAggregatedPrsModal.jsx';
import * as aggregationStorageService from '../../aggregation-storage/aggregation-storage-service.js';
import * as githubConnectionService from '../../github-connection/github-connection-service.js';
import * as githubRepoBrowserService from '../../github-repo-browser/github-repo-browser-service.js';
import * as suggestPrService from '../suggest-pr-service.js';
import * as aggregationProvenanceService from '../aggregation-provenance-service.js';
import * as workspaceTabsService from '../workspace-tabs-service.js';

vi.mock('../../aggregation-storage/aggregation-storage-service.js');
vi.mock('../../github-connection/github-connection-service.js');
vi.mock('../../github-repo-browser/github-repo-browser-service.js');
vi.mock('../suggest-pr-service.js');
vi.mock('../aggregation-provenance-service.js');
vi.mock('../workspace-tabs-service.js');
// aggregation-diff-service.js, source-patch-service.js and
// aggregated-pr-planning-service.js are NOT mocked -- they're pure
// functions with their own dedicated test coverage, and this file's own
// job is to verify the modal wires their real behavior together correctly
// end to end, not to re-verify each one in isolation again.

const {
  diffLines: realDiffLines,
  numberDiffLines: realNumberDiffLines,
  summarizeDrift: realSummarizeDrift,
} = await vi.importActual('../suggest-pr-service.js');

const StubModal = ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null);
StubModal.propTypes = { isOpen: PropTypes.bool.isRequired, children: PropTypes.node.isRequired };

const StubPassthrough = ({ children }) => <div>{children}</div>;
StubPassthrough.propTypes = { children: PropTypes.node.isRequired };

const stubComponents = {
  Modal: StubModal,
  ModalHeader: StubPassthrough,
  ModalTitle: StubPassthrough,
  ModalBody: StubPassthrough,
  ModalFooter: StubPassthrough,
};

const getComponent = (name) => stubComponents[name];

const CONNECTION = { apiBaseUrl: 'https://api.github.com', token: 'test-token' };

const BASELINE_MERGED_TEXT =
  'paths:\n  /users:\n    get:\n      summary: List users\n  /orders:\n    get:\n      summary: List orders\n';

const USERS_SOURCE = {
  name: 'Users',
  url: 'https://github.com/octo-org/users/blob/main/openapi.yaml',
  apiBaseUrl: 'https://api.github.com',
  owner: 'octo-org',
  repo: 'users',
  path: 'openapi.yaml',
  ref: 'main',
  baselineContent: 'paths:\n  /users:\n    get:\n      summary: List users\n',
};

const ORDERS_SOURCE = {
  name: 'Orders',
  url: 'https://github.com/octo-org/orders/blob/main/openapi.yaml',
  apiBaseUrl: 'https://api.github.com',
  owner: 'octo-org',
  repo: 'orders',
  path: 'openapi.yaml',
  ref: 'main',
  baselineContent: 'paths:\n  /orders:\n    get:\n      summary: List orders\n',
};

const RECORD = {
  setName: 'My Set',
  sources: [USERS_SOURCE, ORDERS_SOURCE],
  provenance: {
    paths: {
      '/users': { service: 'Users', originalKey: '/users' },
      '/orders': { service: 'Orders', originalKey: '/orders' },
    },
    tags: {},
    components: {},
  },
  baselineMergedText: BASELINE_MERGED_TEXT,
};

describe('SuggestAggregatedPrsModal', () => {
  beforeEach(() => {
    githubConnectionService.getConnectionSettings.mockResolvedValue(CONNECTION);
    aggregationProvenanceService.getAggregationProvenance.mockReturnValue(RECORD);
    aggregationProvenanceService.setAggregationProvenance.mockReturnValue(undefined);
    suggestPrService.canWriteToRepo.mockResolvedValue(true);
    suggestPrService.buildSuggestionBranchName.mockReturnValue('swagger-editor-suggestion-x');
    suggestPrService.createSuggestionBranch.mockResolvedValue(undefined);
    suggestPrService.createPullRequest.mockResolvedValue('https://github.com/octo-org/x/pull/7');
    suggestPrService.diffLines.mockImplementation(realDiffLines);
    suggestPrService.numberDiffLines.mockImplementation(realNumberDiffLines);
    suggestPrService.summarizeDrift.mockImplementation(realSummarizeDrift);
    githubRepoBrowserService.getFileContent.mockImplementation(async (owner, repo) => ({
      content: repo === 'users' ? USERS_SOURCE.baselineContent : ORDERS_SOURCE.baselineContent,
    }));
    workspaceTabsService.getTabContent.mockReturnValue(BASELINE_MERGED_TEXT);
    // RECORD carries no setId (the field this set-changed check relies on
    // didn't exist when it was aggregated), so run() skips the check
    // entirely without ever calling this -- set only so a test that does
    // give the record a setId isn't tripped up by a stale default.
    aggregationStorageService.getStorageSettings.mockReturnValue({
      owner: 'octo-org',
      repo: 'sets-repo',
      branch: 'main',
    });
    aggregationStorageService.getAggregationSet.mockResolvedValue(null);
  });

  test('renders nothing when closed', () => {
    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen={false}
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Suggest pull requests')).not.toBeInTheDocument();
  });

  test("shows an error when the tab's aggregation link is missing", async () => {
    aggregationProvenanceService.getAggregationProvenance.mockReturnValue(null);

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/aggregation link is missing/)).toBeInTheDocument()
    );
  });

  test('warns instead of routing changes when the saved set was renamed since this tab was aggregated', async () => {
    // Reproduces the real report: the record was saved with setId, but the
    // set's service names have since diverged (a rename, in this case) --
    // this must be caught before the record is ever trusted for routing.
    aggregationProvenanceService.getAggregationProvenance.mockReturnValue({
      ...RECORD,
      setId: 'set-1',
    });
    aggregationStorageService.getAggregationSet.mockResolvedValue({
      id: 'set-1',
      name: 'My Set',
      swaggerUrls: [{ name: 'Users' }, { name: 'Orders (renamed)' }],
    });
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/has been renamed/)).toBeInTheDocument());
    expect(screen.queryByText('octo-org/users')).not.toBeInTheDocument();
  });

  test('proceeds normally when the setId is present but the set has not changed', async () => {
    aggregationProvenanceService.getAggregationProvenance.mockReturnValue({
      ...RECORD,
      setId: 'set-1',
    });
    aggregationStorageService.getAggregationSet.mockResolvedValue({
      id: 'set-1',
      name: 'My Set',
      swaggerUrls: [{ name: 'Orders' }, { name: 'Users' }],
    });
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('octo-org/users')).toBeInTheDocument());
  });

  test('reports nothing to suggest when the tab matches its baseline', async () => {
    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/No changes to suggest/)).toBeInTheDocument());
  });

  test('previews a change to only the touched source, leaving the untouched one out', async () => {
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('octo-org/users')).toBeInTheDocument());
    expect(screen.queryByText('octo-org/orders')).not.toBeInTheDocument();
    expect(screen.getByText('Open pull request')).toBeInTheDocument();
  });

  test('previews changes across multiple touched sources', async () => {
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List all orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('octo-org/users')).toBeInTheDocument());
    expect(screen.getByText('octo-org/orders')).toBeInTheDocument();
    expect(screen.getByText('Open pull requests')).toBeInTheDocument();
  });

  test('flags an entirely new merged path as unresolved rather than guessing at it', async () => {
    workspaceTabsService.getTabContent.mockReturnValue(
      `${BASELINE_MERGED_TEXT}  /new:\n    get: {}\n`
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/won't be included/)).toBeInTheDocument());
    expect(screen.getByText('/new')).toBeInTheDocument();
  });

  test('shows a per-source drift warning and rebases the baseline on Continue anyway', async () => {
    githubRepoBrowserService.getFileContent.mockImplementation(async (owner, repo) => ({
      content:
        repo === 'users'
          ? 'paths:\n  /users:\n    get:\n      summary: List users (renamed upstream)\n'
          : ORDERS_SOURCE.baselineContent,
    }));
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/changed since this set/)).toBeInTheDocument());
    expect(screen.getByText('Users', { exact: false })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Continue anyway'));
    });

    await waitFor(() => expect(screen.getByText('octo-org/users')).toBeInTheDocument());
    expect(aggregationProvenanceService.setAggregationProvenance).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            name: 'Users',
            baselineContent:
              'paths:\n  /users:\n    get:\n      summary: List users (renamed upstream)\n',
          }),
        ]),
      })
    );
  });

  test('skips a source without write access but still previews the rest', async () => {
    suggestPrService.canWriteToRepo.mockImplementation(async (owner, repo) => repo !== 'users');
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List all orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('octo-org/orders')).toBeInTheDocument());
    expect(screen.queryByText('octo-org/users')).not.toBeInTheDocument();
    expect(screen.getByText(/1 source skipped/)).toBeInTheDocument();
    expect(screen.getByText(/write access/)).toBeInTheDocument();
  });

  test('opens one pull request per touched source sequentially, in order', async () => {
    const order = [];
    suggestPrService.createSuggestionBranch.mockImplementation(async ({ repo }) => {
      order.push(repo);
    });
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List all orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('Open pull requests')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Open pull requests'));
    });

    await waitFor(() =>
      expect(screen.getByText(/2 of 2 pull requests opened/)).toBeInTheDocument()
    );
    expect(order).toEqual(['users', 'orders']);
    expect(aggregationProvenanceService.setAggregationProvenance).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({ name: 'Users', baselineContent: USERS_SOURCE.baselineContent }),
          expect.objectContaining({
            name: 'Orders',
            baselineContent: ORDERS_SOURCE.baselineContent,
          }),
        ]),
      })
    );
  });

  test('reports a partial failure without losing the successful result', async () => {
    suggestPrService.createSuggestionBranch.mockImplementation(async ({ repo }) => {
      if (repo === 'orders') {
        throw new Error('boom');
      }
    });
    workspaceTabsService.getTabContent.mockReturnValue(
      'paths:\n  /users:\n    get:\n      summary: List all users\n  /orders:\n    get:\n      summary: List all orders\n'
    );

    render(
      <SuggestAggregatedPrsModal
        getComponent={getComponent}
        isOpen
        tabId="tab-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('Open pull requests')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Open pull requests'));
    });

    await waitFor(() =>
      expect(screen.getByText(/1 of 2 pull requests opened/)).toBeInTheDocument()
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
