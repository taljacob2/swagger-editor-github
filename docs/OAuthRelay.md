# OAuth sign-in instead of a pasted PAT (sketch, not built)

> **Status:** Design sketch only — nothing here is implemented. PAT entry (see
> [docs/Permissions.md](Permissions.md)) remains the only supported way to authenticate, and should
> stay the default even if this gets built: it's the zero-infrastructure option, and this isn't.
> This page exists so the tradeoff is written down once, for anyone wondering "why not just sign in
> with GitHub" and for any collaborator who wants to pick this up.

## The problem this would solve

Today, every user pastes a Personal Access Token into **Connection Settings** (see
[Permissions.md](Permissions.md)) before they can do anything requiring auth. That's simple and
needs zero infrastructure, but it's also manual, and asks a user to understand fine-grained token
scopes just to try the app. A "Sign in with GitHub" button would remove that step for anyone willing
to click through GitHub's own OAuth consent screen instead.

## Why this can't be done as a purely static, backend-free flow

This was worked through in detail; the short version, for anyone tempted to reopen it:

- **GitHub's OAuth token-exchange endpoint doesn't support CORS.** `POST
  https://<host>/login/oauth/access_token` never returns `Access-Control-Allow-Origin`, so a
  browser blocks the exchange call outright — not because GitHub rejects it, but because the
  browser refuses to send/read it on the page's behalf. This is unrelated to which grant type you
  use.
- **PKCE (GitHub Apps, added mid-2025) doesn't change this.** PKCE removes the need for a
  *client secret* in the exchange — a real improvement for public clients — but it's silent on
  CORS. The exact same browser-side block applies whether or not you're using PKCE.
- **GitHub never supported the OAuth implicit grant** (which would've skipped the token-exchange
  POST entirely), and device flow hits the identical CORS wall on its own token-polling endpoint.
- **WebAssembly doesn't route around this either.** CORS is enforced by the browser's networking
  layer itself; WASM has no independent path to the network and can only reach it through the same
  `fetch`/`XHR` machinery JS uses, subject to the same policy.
- **"Static hosting that runs a prebuilt script" is a contradiction.** Static hosting's entire
  contract is "look up a file, return its bytes" — no request-time execution step exists to plug a
  script into. The moment a platform executes *any* code per request (however long ago that code
  was written), it's a compute platform, not a static host. GitHub Pages specifically has zero
  execution capability, permanently, by design — there is no version of this that runs on Pages
  alone.
- **No existing free public relay fits.** Netlify hosts a real, trustworthy OAuth relay for Decap
  CMS, but it only targets `github.com` — it can't be pointed at a GHEC org's custom domain, which
  is this app's actual target deployment. Generic public CORS proxies (`cors-anywhere` and similar)
  are the opposite of safe for this: they're open proxies with real CVEs for exactly this failure
  mode (an operator, or anyone who compromises one, can read every token that passes through). And
  even a reputable third-party relay means live `repo`-scoped tokens for private enterprise repos
  flow through infrastructure outside the org's control — which directly contradicts this app's own
  design goal (see [Design.md's Security notes](Design.md#security-notes)) of keeping everything
  inside domains the org has already approved.

**Conclusion:** the token-exchange step needs *some* server-side hop, full stop. If this is ever
built, that hop has to be something each deploying org runs and controls — small and stateless, but
theirs, not borrowed.

## Sketch, if someone wants to build it

### 1. GitHub App registration (per fork/org, one-time)

Register a **GitHub App**, not a classic OAuth App — Apps get PKCE, fine-grained repo permissions,
and short-lived tokens with refresh, all of which classic OAuth Apps lack. Point its callback URL at
the fork's own Pages URL, enable user-to-server auth, and pick the permissions it needs (repo
contents, at minimum). The output is a `client_id` — public, safe to bake into the build the same
way `GITHUB_API_BASE_URL` already is (see [GettingStarted.md](GettingStarted.md#deploying-your-fork-with-github-pages)).
No secret to protect, since PKCE removes that requirement.

### 2. The relay: two small, stateless endpoints

- `POST /exchange` — body `{code, code_verifier, client_id}`. Forwards to
  `https://<github-host>/login/oauth/access_token` server-side (where CORS doesn't apply), and
  relays the JSON response back with CORS headers scoped to the fork's own Pages origin.
- `POST /refresh` — same shape, with `grant_type=refresh_token`. GitHub App user tokens expire
  (roughly every 8 hours) and need silent renewal — a PAT never needed this, so it's genuinely new
  complexity, not just a rename of the token field.

`github-host` should **not** be caller-supplied — accepting an arbitrary host turns the relay into
an open proxy (the same SSRF shape that's already been flagged against generic CORS proxies above).
Bake in the specific host(s) a given deployment cares about at relay-deploy time instead. No
database, no server-side session — every round trip is self-contained, so the relay can be a single
function with no state to manage. Cloudflare Workers' free tier (100k requests/day) is a natural
fit: deploys via `wrangler deploy`, could live in this repo (e.g. a sibling `relay/` directory) with
its own step in a GitHub Actions workflow, mirroring the existing "push to main, everything
redeploys" story. The one secret this whole system needs is a Cloudflare deploy token — a much
lower-stakes secret than a GitHub OAuth client secret would have been.

### 3. Frontend changes

- Add "Sign in with GitHub" in **Connection Settings**, alongside the existing PAT fields — not
  replacing them.
- On click: generate a PKCE `code_verifier`/`code_challenge` client-side (Web Crypto,
  `crypto.subtle.digest('SHA-256', ...)`), stash the verifier in `sessionStorage`, redirect to
  `https://<host>/login/oauth/authorize?client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256`.
- On the redirect back (`?code=...`): read the stored verifier, `POST` both to the relay's
  `/exchange`, store the resulting token the same way a pasted PAT is stored today (see the
  encrypted-`localStorage` approach noted in
  [Design.md's Progress section](Design.md#progress)).
- Add a background refresh cycle ahead of the ~8-hour expiry, calling `/refresh`. This is the
  biggest net-new piece of frontend complexity — it touches Connection Settings UI, every place a
  token is currently read, and adds an expiry/refresh lifecycle a flat PAT string never had.

### 4. What a forking org has to additionally do

On top of today's [GettingStarted.md](GettingStarted.md) steps: register a GitHub App (a few
clicks, needs org admin), get a free Cloudflare account and API token, and set two new repo
variables (the App's `client_id`, the Cloudflare deploy token). Everything else can be pre-wired CI,
in the same spirit as the existing `GITHUB_API_BASE_URL`/`PAGES_BASE_PATH` variables.

### Rough sizing

Relay + its CI: about half a day. Frontend PKCE + refresh flow: 1-2 days (the real cost center,
since it's genuinely new state management, not a swap of one field for another). Docs for the extra
setup: half a day. Call it **2-3 focused days**, plus the GitHub App and relay becoming new ongoing
operational surface this project doesn't currently have — worth weighing against how much PAT setup
is actually costing adoption before picking this up.
