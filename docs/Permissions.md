# Permissions

This app talks to GitHub directly from your browser — there's no server sitting in the middle,
which means **every user brings their own GitHub token**, and most people need less than they'd
expect (possibly none at all). This page walks through what a token is, which of four permission
tiers you're actually in, how to create the token that tier needs, and what that means if you're
on a team where not everyone has access to the same repos.

## What a token is, and why the app needs one

A Personal Access Token (PAT) is like a password created just for one app to use, instead of
handing it your real GitHub password. It's a long string you generate on GitHub and paste into
this app once (**GitHub** menu → **Connection Settings**). From then on, the app uses it to prove
"this request is authorized on behalf of this user" for anything it needs to do on GitHub.

(A "Sign in with GitHub" button instead of pasting a token has been investigated, but isn't built
— see [docs/GitHubAuthentication.md](GitHubAuthentication.md) for why it needs more than this
app's current zero-backend design, and what it would take.)

**Use a classic token, not a fine-grained one.** Connection Settings only links to classic
personal access token creation now — fine-grained tokens have a sharp, easy-to-miss edge (their
"Resource owner" setting, separate from repository access, can silently leave an organization's
repos completely unreachable even with "All repositories" checked and full org-owner access on
your account) that produced confusing, unexplainable `404`s in practice. See
[docs/GitHubAuthentication.md](GitHubAuthentication.md#classic-pats-only-for-now--fine-grained-tokens-have-a-sharp-edge)
for the full story. The trade-off: a classic token can't be scoped to read-only or to specific
repos the way a fine-grained one can — every tier below now uses the same kind of token, just
possibly more than one of them.

Two things this app might need a token for — and, importantly, it might need *no* token at all:
- **Saving an aggregation set** — writing a file into this repo's `aggregation-data` branch. Always
  needs a token with write access.
- **Fetching a spec to aggregate, or just browsing what's saved** — reading a file from wherever an
  aggregation set points. Only needs a token at all if that content is private.

## Permission tiers

Most people fall into one of these, roughly in order of "most common, least setup required":

| Tier | What you're doing | What you need |
|---|---|---|
| **0 — zero config** | Just browsing/aggregating, and everything involved (this repo, every spec you aggregate) is public | Nothing. Open the site and go — no token, no Connection Settings visit needed. |
| **1 — read-only** | Browsing/aggregating, but this repo or a spec you're aggregating is private | One classic personal access token (`repo` scope), pasted into the **GitHub token** field. |
| **2 — maintainer, public specs** | You'll create/edit/delete sets, and everything you aggregate is public | Same — one classic personal access token (`repo` scope), in the **GitHub token** field. |
| **3 — maintainer, private specs** | You'll create/edit/delete sets *and* aggregate private specs | Same again — one classic personal access token (`repo` scope). |

Tiers 1–3 all need the identical kind of token now — see the classic-vs-fine-grained note above for
why. What still makes them worth telling apart is the picker's guidance on *whether* you need a
token at all, and (for Tiers 2/3) that **Manage Sets** only shows New Set/Edit/Delete once your
token actually has write access to this repo (checked automatically) — otherwise you'll just see
the list and an "Aggregate" button, with a note explaining why the editing controls aren't there.
Nothing to configure for that; it just works based on whatever token you've entered (or haven't).

Don't want to work out which tier you're in by hand? **Connection Settings** has a "What do you
want to do?" picker that maps onto these four options and hands you a pre-filled "Create a
token →" link — the walkthrough below is for anyone who wants the full manual steps instead.

## Step-by-step: creating a token

1. On github.com, click your profile picture (top right) → **Settings**.
2. Scroll to the bottom of the left sidebar → **Developer settings**.
3. **Personal access tokens** → **Tokens (classic)** → **Generate new token** → **Generate new
   token (classic)**.
4. Give it a name, e.g. `swagger-editor-github token`.
5. Under **Select scopes**, check **repo** (the top-level box — this pulls in its sub-scopes too).
6. **Generate token**, copy it, and paste it into **Connection Settings → GitHub token**.

That's it — the same token works for every tier above; which tier you're in only changes whether
you need to paste one at all. If your organization enforces SAML/SSO, there's one extra one-time
step: **Settings → Developer settings → your token → Configure SSO → Authorize** for that
organization. A token that needs this shows up in the app as a rejected request with an
"Authorize this token →" link — [docs/GitHubAuthentication.md](GitHubAuthentication.md) has the
details.

**Why not scope it down to read-only, or to just this repo, the way the old walkthrough did?**
That's exactly the fine-grained-token feature this app has moved away from for now — see the note
under "What a token is" above. The trade-off is real: this token can read and write everywhere
your account can, not just what a given tier strictly needs. If tighter scoping matters more to
you than avoiding the resource-owner gotcha, a fine-grained token still works with this app — the
Contents API doesn't care which kind of token it gets — you'd just need to create and paste it in
by hand, since Connection Settings no longer builds a pre-filled link for one.

## What happens on a team where not everyone has access to the same repos

Say you're in a GitHub Enterprise org with two teams, and Team A doesn't have access to some of
Team B's private repos. Nothing extra needs to be configured for this to work correctly — it
already does, because of how the token model works:

- There is no shared credential anywhere in this app. Every fetch and every save is authorized by
  whatever token *that specific browser* has entered — never a token the app itself holds.
- If someone on Team A aggregates a set that references one of Team B's private repos, their own
  token gets the same 403/404 GitHub would give them for opening that repo directly. The app
  treats that URL as a failed fetch and still returns whatever it *could* merge, with the failure
  called out in the result.
- Someone on Team B, or anyone with access to both, gets the full merge with no errors.

In short: nobody can see more through this app than their own GitHub account already allows.
There's no elevated "service" credential that could leak access across teams.

**One subtlety worth knowing**: the *list* of URLs in a saved set (service names + links, not
their content) lives in this repo's `aggregation-data` branch, so anyone who can read *that*
repo can see "there's a set referencing `github.com/team-b/some-repo/...`" — even if they can't
read what's actually in it. The content stays gated by GitHub's per-repo permission check; the
metadata (what's being referenced) is only as private as read access to this repo itself.
