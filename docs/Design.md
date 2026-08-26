# Design: GitHub Pages Swagger Aggregator

> **Status:** Functional and deployed at https://taljacob2.github.io/swagger-editor-github/. Swagger Editor 5.8.4 is vendored under [`swagger-editor/`](../swagger-editor). Aggregation-set storage, GitHub auth, multi-tab editing, and code generation are implemented; the GitLab-merge-request → GitHub-pull-request plugin port is not yet implemented — see [Progress](#progress) below.

## Overview

This repo aggregates and bundles `swagger.yaml` specs distributed across many microservice repositories into one unified specification, for teams on **GitHub Enterprise Cloud (GHEC) with a custom domain** or plain **github.com**. It's the GitHub-native sibling of [`swagger-editor-gitlab`](https://github.com/taljacob2/swagger-editor-gitlab), which does the same job for on-prem GitLab via a Node proxy.

The key architectural difference from that project is that this one has **no backend server at all**. The GitLab-based repo's `proxy/index.js` exists to work around GitLab-specific constraints (CORS, injecting `PRIVATE-TOKEN` headers, disk-based aggregation-set storage, proxying to a codegen container). None of those constraints hold the same way against GitHub's API, so this is a fully static site, deployable on **GitHub Pages**, that talks to the GitHub REST/Actions API directly from the browser.

## Goals

- Deployable as a 100% static site (GitHub Pages) — no server to run or host.
- No self-hosted backend, and critically, **no dependency on reaching any on-prem network**.
- Works against both **github.com** (personal-account development/testing) and **GitHub Enterprise Cloud with a custom domain** (production), switchable via configuration only — no code fork between the two.
- Forkable: someone who forks this repo gets working aggregation-set storage automatically, without standing up a second repo or any external infrastructure.

## Base

**Swagger Editor 5.8.4**, vendored under [`swagger-editor/`](../swagger-editor) (source only, `.git` stripped). This is a major-version jump from the GitLab-based repo's 4.14.7, with real consequences for porting:

- Build tooling is **Vite**, not webpack — `npm run build` there runs `build:app` (Vite → `swagger-editor/build/`) plus `build:bundle:esm`/`build:bundle:umd`/`build:definitions` (→ `swagger-editor/dist/`). The GitLab-based repo's `webpack/` config directory has no v5 equivalent.
- The custom plugins from the GitLab-based repo — `src/plugins/aggregation/` and the merge-request flow currently living in `src/standalone/topbar/components/Topbar.jsx` — need to be **ported/rewritten** against v5's plugin system, not copied over as-is.

## Why no backend is needed

GitHub's REST API already sends permissive CORS headers and accepts `Authorization: Bearer <PAT>` directly from browser JavaScript — unlike GitLab's API, which is why the GitLab-based repo needs a proxy at all. That removes the need for a proxy layer entirely: raw file fetches, `$ref` resolution, and PR creation can all be direct `fetch()` calls from the client, authenticated with a PAT the user enters (same UX pattern as the GitLab PAT field in the other repo's topbar).

The API base URL (`https://api.github.com` for github.com, `https://api.<domain>` for a GHEC custom domain) is a runtime-configurable setting, resolved and stored client-side (e.g. `localStorage`) since there's no server to read environment variables at startup. It can't be reliably auto-detected from the deployed Pages hostname — a GHEC custom domain doesn't map deterministically to its API host — so the deployment default is instead set at **build time** via a `VITE_GITHUB_API_BASE_URL` env var (wired to a `GH_API_BASE_URL` repo variable in `deploy-pages.yml` — named `GH_` rather than `GITHUB_` because GitHub Actions rejects any repo variable name starting with the reserved `GITHUB_` prefix). A GHEC org forking this repo sets that once in their fork's repo settings, and every visitor gets the right default with nothing to configure; unset, it falls back to `https://api.github.com` — the plain github.com case needs no configuration either way. A value saved explicitly by a user in Connection Settings always overrides both.

## Aggregation-set storage

Replaces the other repo's `/srv/aggregation-sets` disk storage + `createBackup()` logic.

- Dedicated **orphan branch** in this repo (e.g. `aggregation-data`), separate from the branch GitHub Pages builds from — keeps data commits out of the site's history and avoids triggering Pages rebuilds on every save.
- **Bootstrap**: check for the branch via the Git Data API (`GET /repos/{owner}/{repo}/git/refs/heads/aggregation-data`). If missing (404), create it as an orphan: `createBlob` → `createTree` → `createCommit` with no `parents` → `POST /repos/{owner}/{repo}/git/refs`. Lazy, on first save.
- **Layout**: one file per set, `aggregation-sets/<id>.json`, via the Contents API — list (`GET .../contents/aggregation-sets?ref=aggregation-data`), read/update/delete (`GET`/`PUT`/`DELETE .../contents/aggregation-sets/{id}.json?ref=aggregation-data`, fetch-then-write for the required blob `sha`).
- **Versioning is free** from git commit history — no hand-rolled backup files needed.
- **Storage target is configurable** (`owner/repo` + branch), defaulting to this repo. A plain fork gets zero-config storage in its own branch; someone using a shared/hosted instance can point it at their own repo instead.

## Code generation

Needs no custom design: vendored Swagger Editor already ships "Generate Client"/"Generate Server"
menus (`src/plugins/top-bar/components/GenerateServerMenu/`, wired into `TopBar.jsx`) that call the
public `generator3.swagger.io` (OpenAPI 3) and `generator.swagger.io` (OpenAPI 2) services directly
from the browser — no backend, no GitHub Actions workflow, no self-hosted generator container.

An earlier design here replaced the other repo's `/swaggergen` proxy + self-hosted
`swaggerapi/swagger-generator-v3` container with a `codegen.yml` GitHub Actions workflow
(`workflow_dispatch` → run the container in CI → upload an artifact). That was genuinely redundant
with the built-in menus above — same job, just slower (waiting on a CI run) and with real
infrastructure (a workflow, artifact polling, correlation IDs) standing in for something that
already works with zero configuration — so it was removed rather than finished.

## Hosting

GitHub Pages, static build output only. On a personal free GitHub account, Pages requires a **public** repo (private-repo Pages needs Pro/Team/Enterprise) — this repo is public for that reason, and it doubles as a real test of forkability.

## Dev workflow: github.com vs. GHEC

Develop against this personal github.com repo, then point the API base URL and storage-repo settings at a GHEC custom domain for production — no code fork, config only. One thing personal-account testing can't validate: if a target GHEC org enforces SAML SSO, PATs need a one-time "authorize for SSO" step with no github.com-personal equivalent — verify that against the real org before going live.

## Security notes

- No service is ever exposed as a standalone public endpoint — all compute runs inside GitHub-hosted Actions runners, on demand.
- No part of this design requires network access into an on-prem VLAN.
- **No shared credential exists anywhere in this app** — every user brings their own token(s), so per-repo/per-team access control (e.g. a GHEC org where one team can't see another's private repos) is enforced by GitHub itself, per-request, for free. Nobody can see more through this app than their own GitHub account already allows. See [docs/Permissions.md](Permissions.md) for the full explanation, including the one subtlety worth knowing: a saved set's *URL list* is only as private as read access to the storage repo, even though the *content* behind a private URL stays properly gated.
- **Most usage needs no write access, and some needs no token at all.** Reading/aggregating sets is a pure read path; a write-capable token is only required to save or edit a set. If the storage repo and every aggregated spec are public, no token is needed whatsoever. The UI reflects this automatically (`canWriteToStorage` in `aggregation-storage-service.js` checks push access and hides the New Set/Edit/Delete controls when it's absent) rather than assuming every visitor is a maintainer.

## Progress

- [x] Vendor Swagger Editor 5.8.4 (`swagger-editor/`)
- [x] GitHub Pages deploy workflow (`.github/workflows/deploy-pages.yml`) — see [docs/GettingStarted.md](GettingStarted.md) for how a fork deploys its own copy
- [x] Configurable API base URL (github.com vs. GHEC) + PAT entry, replacing the proxy-mediated GitLab auth (`GitHub` menu in the top bar, `src/plugins/github-connection/`). The PAT is encrypted at rest in `localStorage` with a browser-generated AES-GCM key, ported from the GitLab-based repo's `TokenCrypto`/`docs/RememberToken.md` — same caveat applies: it guards against casual inspection of storage, not a fully compromised device, since the key lives alongside the ciphertext. The service layer still supports a separate optional "fetch token" (falling back to the main token when unset — see `fetchToken` in `github-connection-service.js`), but Connection Settings' UI only ever writes the one field now (see the classic-PAT switch below); a `fetchToken` set some other way, e.g. from before that change, still works. See [docs/Permissions.md](Permissions.md) for the four permission tiers this maps to, from zero-config (everything public) to full maintainer access.
- [x] Aggregation-set storage against the `aggregation-data` orphan branch (Contents + Git Data API) — `Aggregate` menu in the top bar, `src/plugins/aggregation-storage/`. Storage location (owner/repo/branch) is user-editable; sets can be created/edited/deleted, but the actual multi-service bundling/merge logic is still the next checklist item.
- [x] Aggregation plugin port (from `swagger-editor-gitlab`'s `src/plugins/aggregation/`) to v5's plugin system — `aggregation-merge-service.js` ports `mergeSwaggerSpecs`/`fetchAllSpecs` (fixing a real bug along the way: the original only tracked schema-name collisions, so same-named `parameters`/`responses`/etc. across services could silently overwrite each other instead of being prefixed — now every `components/*` sub-collection is tracked independently). Each saved set gets an "Aggregate" button that fetches its URLs, merges them, and loads the result straight into the editor via `editorActions.setContent`. The PAT is only ever attached to requests targeting a recognized GitHub host, never to an arbitrary third-party URL a set happens to reference. A github.com raw/blob URL is transparently rewritten to the equivalent `api.github.com` Contents API call instead of being fetched as-is — `raw.githubusercontent.com` rejects any cross-origin request carrying an `Authorization` header at the CORS preflight stage (confirmed against the live service, not just inferred), so fetching it directly can never work once a token is involved, for public or private repos alike; going through the Contents API is what makes the "fetch token for private specs" tier actually functional. The same rewrite is generalized to a GHEC/GHE.com custom domain by deriving its web/raw hosts from the user's own configured `apiBaseUrl` (`api.<domain>` → `<domain>` for blob URLs, `raw.<domain>` for raw URLs, by analogy with github.com's own host split) — the blob-URL half is high-confidence since it's the same product's file-viewer route on a different domain, but the `raw.<domain>` guess is unverified against a real GHEC/GHE.com org. See [docs/Aggregation.md](Aggregation.md) for the user-facing conflict-resolution rules and a full worked example.
- [x] Authenticated resolution of a `$ref` that points at another private-repo file — the Contents API rewrite above only covered an aggregation set's own URL list (`fetchSpec`); live validation, hover, go-to-definition, and "Resolve document"/"Download Resolved" all follow `$ref`s through a completely separate pipeline (`@swagger-api/apidom-reference`, run inside `apidom.worker.js`), which had no GitHub-awareness or auth at all and hit the same raw-host CORS wall from a different call site. Fixed with a custom `Resolver` (`src/plugins/editor-monaco-language-apidom/language/github-resolver.js`, sharing the URL-rewrite logic in `src/plugins/github-connection/github-file-url.js` with `fetchSpec`) prepended to apidom-reference's own default resolver chain, with the worker kept up to date via `ApiDOMWorker#setConnectionSettings` (pushed on essentially every call from `apidom-mode.js`, cheaply no-op'd via reference-equality once nothing's changed). Getting hover/go-to-definition/the explicit dereference actions to actually pick this up required a small **patch-package patch to `@swagger-api/apidom-ls`** (`patches/@swagger-api+apidom-ls+1.12.0.patch`): its `hover-service`/`definition-service`/`deref-service` hardcoded their resolve options and silently ignored any configured `referenceOptions.resolve`, unlike `validation-service` which already threaded it through — the patch makes all three match that existing pattern (purely additive: identical behavior when no custom resolver is configured).
- [x] Authenticated `$ref` resolution for the live Preview pane — the `apidom-reference`/`apidom-ls` fix above covers editor-side validation/hover/go-to-definition/"Resolve document", but SwaggerUI core's own `spec` plugin (`swagger-client`, feeding `EditorPreviewSwaggerUI` via `specActions.updateSpec`) resolves `$ref`s through a **third**, completely independent pipeline with no GitHub-awareness either — a private repo's `$ref` still 404'd in the Preview pane after the fix above shipped, even though the editor's own validation/hover already worked. `swagger-client` threads `requestInterceptor`/`responseInterceptor` (its own config, unrelated to Monaco/ApiDOM) through every fetch it makes for spec resolution, so `src/plugins/github-connection/github-fetch-interceptors.js` implements the same Contents API rewrite as `fetchSpec`/`GitHubResolver`, wired in once in `App.tsx` ahead of whatever `requestInterceptor`/`responseInterceptor` a caller of the `<SwaggerEditor>` component passes in (never replacing it — chained, so a library consumer's own interceptor still runs, just against an already-rewritten GitHub request/response). Same interceptors also run ahead of "Try it out" operation execution, but are a no-op there since neither a real API's request URL nor its response shape matches a GitHub raw/blob URL or a Contents API base64 envelope.
- [x] Switched Connection Settings from fine-grained to classic PATs — root-caused a live report of every private-repo `$ref`/aggregation-set request 404ing for an org owner with a token set to "All repositories": a fine-grained token's **Resource owner** (chosen at creation, separate from repository access) was the user's personal account rather than the org, so "All repositories" only ever covered personal repos, and GitHub's Contents API returns the same `404` for "repo the token can't see" as for "repo doesn't exist" (by design, to avoid confirming private-repo existence) — indistinguishable from any other cause without knowing to check that one setting. `src/plugins/github-connection/components/GitHubMenuHandler.jsx` now collapses the old two-field (Repo token / Fetch token) UI to a single **GitHub token** field, linking to a new `buildClassicTokenCreationUrl` (classic PAT, `repo` scope) instead of the fine-grained `buildTokenCreationUrl`; the latter and its tests stay in `github-connection-service.js`, unused by the UI, kept for a possible future return to fine-grained tokens. See [docs/GitHubAuthentication.md](GitHubAuthentication.md#classic-pats-only-for-now--fine-grained-tokens-have-a-sharp-edge) for the full explanation and [docs/Permissions.md](Permissions.md) for the updated tier walkthrough.
- [ ] Merge-request flow ported to GitHub Pull Requests (from `swagger-editor-gitlab`'s `Topbar.jsx`)
- [x] Code generation — no port needed; vendored Swagger Editor's built-in "Generate Client"/"Generate Server" menus already call the public generator services directly (see [Code generation](#code-generation)). The custom `codegen.yml` GitHub Actions workflow this repo scaffolded early on was redundant with that and has been removed.

## Open items — not yet decided

- UI/UX details for surfacing the storage-repo settings to the user.
- Whether GHEC's Contents/Git Data/Actions API semantics need any adjustment versus github.com's (expected: none, but unverified against a real GHEC org).
- Replacing pasted-PAT auth with a "Sign in with GitHub" OAuth flow — investigated and written up, not started; see [docs/GitHubAuthentication.md](GitHubAuthentication.md) for why it needs a relay GitHub itself can't yet avoid, and what building one would take.
