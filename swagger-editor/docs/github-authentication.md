# GitHub Authentication: Why Personal Access Tokens (For Now)

This app talks to the GitHub API directly from the browser — there is no server component,
and it's deployed as a static site (GitHub Pages). That single fact is the root cause of
everything in this document: it rules out the OAuth flow most users expect ("Sign in with
GitHub"), and it's why the app instead asks users to paste a Personal Access Token (PAT) in
[`GitHubMenuHandler`](../src/plugins/github-connection/components/GitHubMenuHandler.jsx).

This was investigated in depth (see history around 2026-08) after a request to replace PATs
with SSO/browser-based auth "for enterprise domains." This document records what was found,
what we shipped as a stopgap, and what would need to change upstream before we can revisit it.

## The current approach

- The user pastes one or more PATs (a repo-scoped write token, and optionally a separate
  read-only token) into the GitHub Connection Settings modal.
- Tokens are stored in the browser's `localStorage` only, and sent only to the configured API
  base URL (`https://api.github.com`, or a GitHub Enterprise Cloud custom domain).
- See [`github-connection-service.js`](../src/plugins/github-connection/github-connection-service.js)
  and [`aggregation-storage-service.js`](../src/plugins/aggregation-storage/aggregation-storage-service.js)
  for where tokens are read and attached to requests.

This works, but it's a rougher UX than "click a button, approve on GitHub" — especially for
enterprise users who also have to deal with SAML/SSO enforcement on top of the token itself.

## Why not "Sign in with GitHub" (OAuth)?

### The classic flow needs a secret we can't keep

GitHub's standard OAuth Authorization Code flow exchanges a short-lived `code` for an access
token via `POST /login/oauth/access_token`, and that request must include the app's
`client_secret`. A static SPA with no backend has nowhere to put a secret that a browser
DevTools tab can't read — anyone could extract it and mint tokens as this app. So the classic
flow is a non-starter without standing up a backend of some kind.

### Could GitHub Actions be that backend?

We considered whether GitHub Actions could act as a lightweight "lambda" to hold the secret and
do the token exchange. It can't, for two reasons:

1. Actions is an event-triggered batch job runner, not a synchronous request/response service —
   there's real cold-start latency and no clean way for a browser tab to "call" a workflow and
   get a token back in the same request/response cycle a login flow needs.
2. Triggering a workflow run at all requires an authenticated request (a PAT or GitHub App
   token with `workflow` scope) — which just moves the "embed a secret in the SPA" problem up
   one level instead of solving it.

Any real fix needs an actual always-on backend (even a tiny serverless function) or GitHub
removing the client-secret requirement for public clients. We don't want to add a required
backend to what is otherwise a zero-infrastructure, GitHub-Pages-hosted app, so we've held off implementing this ourselves.

### GitHub's newer SPA-friendly flow — Preview, and still blocked

GitHub has a roadmap item for exactly this:
[github/roadmap#1153 — "Single page app support for GitHub Apps"](https://github.com/github/roadmap/issues/1153).
As of 2026-08, it's still labeled **Preview** and **Paused**. Its own description confirms it's
meant to solve this precise problem — PKCE, no client secret, and (notably for the original
"enterprise SSO" ask) it explicitly allows re-authentication to satisfy org/enterprise SSO
without re-entering GitHub credentials:

> SPA developers no longer need to implement an extra backend or use unsafe proxy tunnels to
> work around the lack of CORS support that blocked the use of SPAs. They also no longer need
> to include a client secret in their application in order to redeem the access token.

The blocker in practice is CORS, not just PKCE. GitHub added PKCE support in July 2025
([changelog](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/)),
but the `/access_token` token-redemption endpoint still doesn't send CORS headers, so a
browser-only app still can't call it directly — and GitHub still requires a client secret for
every client because they don't yet distinguish "public" (browser/native) clients from
"confidential" (server) ones. From GitHub staff (`hpsin`) directly, in
[community#15752 — "Support PKCE flow for OAuth apps"](https://github.com/orgs/community/discussions/15752):

> For the client secret, yes, our implementation always requires the client secret as we don't
> yet distinguish between public clients and confidential clients. So at this time, native apps
> and SPA type apps need to include their client secret in the redemption. I don't have an
> estimate for when we can remove this requirement unfortunately.

> Correct, you cannot yet auth a SPA as we don't have CORS for the token endpoint yet. We'd
> really love to not have folks create PATs for this, so I'll update when I have more details
> about the CORS options here.

As of the most recent activity on that thread (October 2025), this is still the case —
confirmed independently by the maintainer of Sveltia CMS (`kyoshino`), a comparable
GitHub-Pages-style tool hitting the identical wall (see below): "You still cannot use PKCE
until GitHub supports CORS and makes the client secret optional."

## Precedent: other GitHub-Pages-style tools hit the same wall

[Sveltia CMS](https://github.com/sveltia/sveltia-cms) (2.7k+ stars, successor to Netlify/Decap
CMS) is architecturally very close to this app — a static, git-backed editor with no required
backend. It has the same constraint and defaults to the same workaround: direct PAT entry, with
requests going straight from the CMS to the GitHub API. For users who specifically want an
OAuth-style login instead, Sveltia offers
[`sveltia-cms-auth`](https://github.com/sveltia/sveltia-cms-auth), a small open-source
Cloudflare Worker that *is* the backend doing the token exchange — an optional, self-hosted
add-on, not something baked into the core static app.

This is the same trade-off we're making: PAT-by-default keeps the app deployable as a static
site with zero required infrastructure; a real OAuth login would require someone to opt into
running a small backend piece, same as Sveltia's model.

## What we shipped instead: surfacing the SSO-authorization link

Since we can't replace PATs with OAuth login today, we improved the PAT flow for the enterprise
SSO case that motivated this investigation. A **valid** PAT can still get rejected with a `403`
on an organization that enforces SAML/SSO, until the user manually authorizes that specific
token for that org on GitHub's site. GitHub signals this with an `X-GitHub-SSO` response header
containing `required; url=<authorization-url>`.

Previously this just looked like a generic permission-denied error. Now:

- [`parseSsoAuthorizationUrl`](../src/plugins/github-connection/github-connection-service.js)
  extracts that URL from the response header.
- [`aggregation-storage-service.js`](../src/plugins/aggregation-storage/aggregation-storage-service.js)
  and [`aggregation-merge-service.js`](../src/plugins/aggregation-storage/aggregation-merge-service.js)
  attach it (`error.ssoUrl`) to thrown errors instead of just the generic status message.
- [`GitHubMenuHandler.jsx`](../src/plugins/github-connection/components/GitHubMenuHandler.jsx)
  and
  [`AggregateMenuHandler.jsx`](../src/plugins/aggregation-storage/components/AggregateMenuHandler.jsx)
  render an "Authorize this token →" link straight to that URL whenever it's present, instead of
  a dead-end "permission denied."

This doesn't remove the need for a PAT, but it turns "why is my valid token being rejected?"
into a one-click fix for the SSO case specifically. Shipped in commit `2598d79`.

## Revisiting this later

This is worth re-examining if any of the following changes:

1. **GitHub un-pauses / ships github/roadmap#1153** and enables CORS on the token endpoint for
   SPA-type GitHub Apps. At that point a real client-side PKCE flow becomes possible with zero
   required backend, and would be a strictly better default than PATs — check the roadmap issue
   and the linked community discussion for the current status before starting any work here.
2. **We decide a small optional backend is acceptable.** A Cloudflare Worker (or any tiny
   serverless function) doing only the `code` → token exchange, following the
   `sveltia-cms-auth` model, would unlock full OAuth login today without waiting on GitHub. This
   would need to stay strictly optional (PAT entry must keep working) so the app can still be
   used as a pure static site with no infrastructure at all.

If you pick this up, `sveltia-cms-auth`'s source is a good reference for the minimal shape of
that exchange, and the two GitHub threads linked above are the fastest way to check whether the
CORS/client-secret situation has moved.
