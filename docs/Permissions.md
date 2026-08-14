# Permissions

This app talks to GitHub directly from your browser — there's no server sitting in the middle,
which means **every user brings their own GitHub token(s)**, and most people need less than they'd
expect (possibly none at all). This page walks through what a token is, which of four permission
tiers you're actually in, how to create the token(s) that tier needs, and what that means if you're
on a team where not everyone has access to the same repos.

## What a token is, and why the app needs one

A Personal Access Token (PAT) is like a password created just for one app to use, instead of
handing it your real GitHub password. It's a long string you generate on GitHub and paste into
this app once (**GitHub** menu → **Connection Settings**). From then on, the app uses it to prove
"this request is authorized on behalf of this user" for anything it needs to do on GitHub.

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
| **1 — read-only** | Browsing/aggregating, but this repo or a spec you're aggregating is private | One **read-only** token, pasted into the **Repo token** field (leave **Fetch token** blank — it falls back to the repo token, which is already read-only). |
| **2 — maintainer, public specs** | You'll create/edit/delete sets, and everything you aggregate is public | One **read-and-write** token, scoped to `swagger-editor-github` only, in the **Repo token** field. |
| **3 — maintainer, private specs** | You'll create/edit/delete sets *and* aggregate private specs | Two tokens: the write-scoped **Repo token** (still `swagger-editor-github` only) plus a read-only **Fetch token** for the private repo(s). |

The app reflects this in the UI: **Manage Sets** only shows New Set/Edit/Delete when your Repo
token actually has write access to `swagger-editor-github` (checked automatically) — otherwise
you'll just see the list and an "Aggregate" button, with a note explaining why the editing controls
aren't there. Nothing to configure for that; it just works based on whatever token you've entered
(or haven't).

Don't want to work out which tier you're in by hand? **Connection Settings** has a "What do you
want to do?" picker that maps straight onto these four options and hands you a pre-filled
"Create a token →" link for whichever one you need — the walkthrough below is for anyone who wants
the full manual steps instead.

## Step-by-step: creating a token

Both a read-only token (Tiers 1 and 3's Fetch token) and a write token (Tiers 2 and 3's Repo token)
start the same way:

1. On github.com, click your profile picture (top right) → **Settings**.
2. Scroll to the bottom of the left sidebar → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

Then they diverge:

### Read-only token (Tier 1, or Tier 3's Fetch token)

4. Give it a name, e.g. `swagger-editor-github read-only token`.
5. Under **Repository access**, choose **Only select repositories** → select whichever repo(s) you
   need to read (this repo itself for Tier 1, or the private spec repo(s) for Tier 3).
6. Under **Permissions** → **Repository permissions**, find **Contents** → set it to **Read-only**.
7. **Generate token**, copy it, and paste it into **Connection Settings** — the **Repo token** field
   for Tier 1, or **Fetch token** for Tier 3.

### Write token (Tiers 2 and 3's Repo token)

4. Give it a name, e.g. `swagger-editor-github repo token`.
5. Under **Repository access**, choose **Only select repositories** → select `swagger-editor-github`
   only.
6. Under **Permissions** → **Repository permissions**, find **Contents** → set it to **Read and write**.
7. **Generate token**, copy it, and paste it into **Connection Settings → Repo token**.

**Why can't one token cover write-here-read-there (Tier 3)?** A fine-grained token applies one
permission level uniformly to every repo you select in it — there's no way to say "write here,
read-only there" within a single token. Splitting write-access-to-this-app's-repo from
read-access-to-everything-else is the only way to keep both scoped to what they actually need.

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
