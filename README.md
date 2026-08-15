# Swagger Editor for GitHub

Aggregate and bundle distributed `swagger.yaml` specs across microservice repositories into one unified specification — for teams on **GitHub Enterprise Cloud (custom domain)** or plain **github.com**.

Built on [Swagger Editor 5.8.4](https://github.com/swagger-api/swagger-editor), deployed as a fully static site on **GitHub Pages**, with no backend server: all GitHub access, aggregation-set storage, and code generation happen through the GitHub REST/Actions API directly from the browser.

This is the GitHub-native sibling of [`swagger-editor-gitlab`](https://github.com/taljacob2/swagger-editor-gitlab), which solves the same problem for on-prem GitLab.

## Status

Early scaffolding — see [docs/Design.md](docs/Design.md) for the full architecture and a progress checklist. Not yet functional.

## Permissions

This app has no backend — every user brings their own GitHub token(s). See
[docs/Permissions.md](docs/Permissions.md) for how to create them and what that means for teams
where not everyone has access to the same repos.

## Keyboard shortcuts

The editor supports a multi-tab workspace with keyboard shortcuts for switching, managing, and
undoing/redoing changes in tabs — see [docs/KeyboardShortcuts.md](docs/KeyboardShortcuts.md) for
the full list.

## Development

```bash
cd swagger-editor
npm install
npm run start
```
