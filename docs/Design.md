# Design: GitHub Pages Swagger Aggregator

> **Status:** Scaffolding in progress. Swagger Editor 5.8.4 is vendored under [`swagger-editor/`](../swagger-editor). Aggregation-set storage, code generation, and the GitLab-merge-request → GitHub-pull-request plugin port are not yet implemented — see [Progress](#progress) below.

## Overview

This repo aggregates and bundles `swagger.yaml` specs distributed across many microservice repositories into one unified specification, for teams on **GitHub Enterprise Cloud (GHEC) with a custom domain** or plain **github.com**. It's the GitHub-native sibling of [`swagger-editor-gitlab`](https://github.com/taljacob2/swagger-editor-gitlab), which does the same job for on-prem GitLab via a Node proxy.

The key architectural difference from that project is that this one has **no backend server at all**. The GitLab-based repo's `proxy/index.js` exists to work around GitLab-specific constraints (CORS, injecting `PRIVATE-TOKEN` headers, disk-based aggregation-set storage, proxying to a codegen container). None of those constraints hold the same way against GitHub's API, so this is a fully static site, deployable on **GitHub Pages**, that talks to the GitHub REST/Actions API directly from the browser.

## Goals

- Deployable as a 100% static site (GitHub Pages) — no server to run or host.
- No self-hosted backend, and critically, **no dependency on reaching any on-prem network** (the codegen piece in particular must never require routing traffic into a private VLAN).
- Works against both **github.com** (personal-account development/testing) and **GitHub Enterprise Cloud with a custom domain** (production), switchable via configuration only — no code fork between the two.
- Forkable: someone who forks this repo gets working aggregation-set storage and code generation automatically, without standing up a second repo or any external infrastructure.

## Base

**Swagger Editor 5.8.4**, vendored under [`swagger-editor/`](../swagger-editor) (source only, `.git` stripped). This is a major-version jump from the GitLab-based repo's 4.14.7, with real consequences for porting:

- Build tooling is **Vite**, not webpack — `npm run build` there runs `build:app` (Vite → `swagger-editor/build/`) plus `build:bundle:esm`/`build:bundle:umd`/`build:definitions` (→ `swagger-editor/dist/`). The GitLab-based repo's `webpack/` config directory has no v5 equivalent.
- The custom plugins from the GitLab-based repo — `src/plugins/aggregation/` and the merge-request flow currently living in `src/standalone/topbar/components/Topbar.jsx` — need to be **ported/rewritten** against v5's plugin system, not copied over as-is.

## Why no backend is needed

GitHub's REST API already sends permissive CORS headers and accepts `Authorization: Bearer <PAT>` directly from browser JavaScript — unlike GitLab's API, which is why the GitLab-based repo needs a proxy at all. That removes the need for a proxy layer entirely: raw file fetches, `$ref` resolution, and PR creation can all be direct `fetch()` calls from the client, authenticated with a PAT the user enters (same UX pattern as the GitLab PAT field in the other repo's topbar).

The API base URL (`https://api.github.com` for github.com, `https://api.<domain>` for a GHEC custom domain) is a runtime-configurable setting, resolved and stored client-side (e.g. `localStorage`) since there's no server to read environment variables at startup.

## Aggregation-set storage

Replaces the other repo's `/srv/aggregation-sets` disk storage + `createBackup()` logic.

- Dedicated **orphan branch** in this repo (e.g. `aggregation-data`), separate from the branch GitHub Pages builds from — keeps data commits out of the site's history and avoids triggering Pages rebuilds on every save.
- **Bootstrap**: check for the branch via the Git Data API (`GET /repos/{owner}/{repo}/git/refs/heads/aggregation-data`). If missing (404), create it as an orphan: `createBlob` → `createTree` → `createCommit` with no `parents` → `POST /repos/{owner}/{repo}/git/refs`. Lazy, on first save.
- **Layout**: one file per set, `aggregation-sets/<id>.json`, via the Contents API — list (`GET .../contents/aggregation-sets?ref=aggregation-data`), read/update/delete (`GET`/`PUT`/`DELETE .../contents/aggregation-sets/{id}.json?ref=aggregation-data`, fetch-then-write for the required blob `sha`).
- **Versioning is free** from git commit history — no hand-rolled backup files needed.
- **Storage target is configurable** (`owner/repo` + branch), defaulting to this repo. A plain fork gets zero-config storage in its own branch; someone using a shared/hosted instance can point it at their own repo instead.

## Code generation

Replaces the other repo's `/swaggergen` proxy + `swaggerapi/swagger-generator-v3` container in its `docker-compose.yaml`.

1. **Handoff**: frontend commits the bundled spec to the data branch, e.g. `codegen-requests/<correlation-id>.yaml`.
2. **Trigger**: `POST /repos/{owner}/{repo}/actions/workflows/codegen.yml/dispatches` (`workflow_dispatch`, inputs: `correlation_id`, `generator`, `language`) — same PAT, same direct-from-browser call, inherently access-controlled to users with `actions:write` on the repo.
3. **Run**: workflow checks out the spec and runs `swaggerapi/swagger-generator-v3` against it.
4. **Retention**: output uploaded via `actions/upload-artifact` with `retention-days: 1` — native expiry, no cleanup workflow.
5. **Delivery**: frontend polls `GET /repos/{owner}/{repo}/actions/artifacts?name=<correlation-id>` until it appears, then links to the parent Actions run page (`https://github.com/{owner}/{repo}/actions/runs/{run_id}`) for the user to download via their own logged-in session — not a direct artifact-bytes fetch, since that endpoint needs an auth header a plain link can't send, its redirect target isn't reliably CORS-enabled for `fetch`, and the resulting URL is short-lived anyway.

All codegen traffic routes through GitHub's own infrastructure — nothing is ever exposed on the public internet as a standalone service, and nothing requires reaching an on-prem network.

## Hosting

GitHub Pages, static build output only. On a personal free GitHub account, Pages requires a **public** repo (private-repo Pages needs Pro/Team/Enterprise) — this repo is public for that reason, and it doubles as a real test of forkability.

## Dev workflow: github.com vs. GHEC

Develop against this personal github.com repo, then point the API base URL and storage-repo settings at a GHEC custom domain for production — no code fork, config only. One thing personal-account testing can't validate: if a target GHEC org enforces SAML SSO, PATs need a one-time "authorize for SSO" step with no github.com-personal equivalent — verify that against the real org before going live.

## Security notes

- Codegen workflow only triggerable by users with write/`actions` access — same trust boundary as git write access.
- No service is ever exposed as a standalone public endpoint — all compute runs inside GitHub-hosted Actions runners, on demand.
- No part of this design requires network access into an on-prem VLAN.

## Progress

- [x] Vendor Swagger Editor 5.8.4 (`swagger-editor/`)
- [ ] GitHub Pages deploy workflow
- [x] Configurable API base URL (github.com vs. GHEC) + PAT entry, replacing the proxy-mediated GitLab auth (`GitHub` menu in the top bar, `src/plugins/github-connection/`). The PAT is encrypted at rest in `localStorage` with a browser-generated AES-GCM key, ported from the GitLab-based repo's `TokenCrypto`/`docs/RememberToken.md` — same caveat applies: it guards against casual inspection of storage, not a fully compromised device, since the key lives alongside the ciphertext.
- [x] Aggregation-set storage against the `aggregation-data` orphan branch (Contents + Git Data API) — `Aggregate` menu in the top bar, `src/plugins/aggregation-storage/`. Storage location (owner/repo/branch) is user-editable; sets can be created/edited/deleted, but the actual multi-service bundling/merge logic is still the next checklist item.
- [ ] Aggregation plugin port (from `swagger-editor-gitlab`'s `src/plugins/aggregation/`) to v5's plugin system
- [ ] Merge-request flow ported to GitHub Pull Requests (from `swagger-editor-gitlab`'s `Topbar.jsx`)
- [ ] `codegen.yml` workflow (`workflow_dispatch` → `swagger-generator-v3` → artifact with 1-day retention)
- [ ] Frontend polling + Actions-run-page linking for codegen results

## Open items — not yet decided

- UI/UX details for surfacing the storage-repo and codegen settings to the user.
- Whether GHEC's Contents/Git Data/Actions API semantics need any adjustment versus github.com's (expected: none, but unverified against a real GHEC org).
