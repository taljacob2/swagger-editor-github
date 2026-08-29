# Swagger Editor for GitHub

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Aggregate and bundle distributed `swagger.yaml` specs across microservice repositories into one unified specification — for teams on **GitHub Enterprise Cloud (custom domain)** or plain **github.com**.

Built on [Swagger Editor 5.8.4](https://github.com/swagger-api/swagger-editor), deployed as a fully static site on **GitHub Pages**, with no backend server: all GitHub access, aggregation-set storage, and code generation happen through the GitHub REST/Actions API directly from the browser.

This is the GitHub-native sibling of [`swagger-editor-gitlab`](https://github.com/taljacob2/swagger-editor-gitlab), which solves the same problem for on-prem GitLab.

**Try it now:** https://taljacob2.github.io/swagger-editor-github/ — no install, no account, no token needed for public specs.

## Status

Aggregation-set storage, GitHub-token-based auth, multi-tab editing with persisted per-tab undo/redo, drag-to-reorder tabs, code generation, and suggesting a pull request back to a linked repo file are all implemented and live at the URL above — see [docs/Design.md](docs/Design.md) for the full architecture and progress checklist.

## Getting started

| Your situation | What to do |
| --- | --- |
| Just browsing/aggregating public specs | Open [the hosted site](https://taljacob2.github.io/swagger-editor-github/) — nothing to install |
| Reading private specs, on github.com | Open the hosted site, add a read-only token |
| Reading private specs, on GitHub Enterprise Cloud | **[Fork this repo](docs/GettingStarted.md#forking)** |
| Creating/editing/deleting aggregation sets (any host) | **[Fork this repo](docs/GettingStarted.md#forking)** |

Full walkthrough, including how to fork on github.com vs. GitHub Enterprise Cloud and how to deploy
your fork with GitHub Pages: **[docs/GettingStarted.md](docs/GettingStarted.md)**.

## Permissions

This app has no backend — every user brings their own GitHub token(s). See
[docs/Permissions.md](docs/Permissions.md) for how to create them and what that means for teams
where not everyone has access to the same repos.

## Why tokens, not "Sign in with GitHub"

A static, backend-free SPA can't safely do a real OAuth login (it would need to embed a secret
anyone could extract), and GitHub's own SPA-friendly OAuth flow is still Preview and blocked on
CORS. See [docs/GitHubAuthentication.md](docs/GitHubAuthentication.md) for the full research,
what we shipped instead for enterprise SSO users, and what would need to change to revisit this.

## Keyboard shortcuts

The editor supports a multi-tab workspace with keyboard shortcuts for switching, managing, and
undoing/redoing changes in tabs — see [docs/KeyboardShortcuts.md](docs/KeyboardShortcuts.md) for
the full list.

## Working with `$ref` across files

Specs can reference schemas/parameters/responses defined in a completely different file via `$ref`
— and this app gives you three ways to see or export the fully resolved result, including
repurposing the built-in "Generate Client" menu as a spec bundler. See
[docs/ResolvingReferences.md](docs/ResolvingReferences.md).

## Aggregating specs from multiple services

The **Aggregate** menu merges several independent, whole specs — one per microservice, say — into
a single spec, auto-resolving any path/tag/component name collisions between them. See
[docs/Aggregation.md](docs/Aggregation.md) for a full worked example.

## Suggesting a pull request

Link a tab to a file in a GitHub repo (via the tab bar's pull-request icon, or **File → Suggest
pull request…**), and this app can propose your edits back to it as a real pull request — with
drift detection, an inline diff preview, and automatic JSON/YAML conversion to match the target
file. See [docs/SuggestingPullRequests.md](docs/SuggestingPullRequests.md) for the full walkthrough.

## License

This repository is licensed under the [Apache License, Version 2.0](LICENSE). It vendors and
extends [Swagger Editor 5.8.4](https://github.com/swagger-api/swagger-editor) (also Apache-2.0)
under [`swagger-editor/`](swagger-editor); see [NOTICE](NOTICE) for full attribution, including
Swagger Editor's own upstream notices in [`swagger-editor/NOTICE`](swagger-editor/NOTICE). "Swagger"
and the Swagger logo are trademarks of SmartBear Software Inc.; this project is not affiliated with
or endorsed by SmartBear.

## Development

```bash
cd swagger-editor
npm install
npm run start
```
