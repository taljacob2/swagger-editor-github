# Permissions

This app talks to GitHub directly from your browser — there's no server sitting in the middle,
which means **every user brings their own GitHub token**. This page explains what a token is,
how to create the two this app can use, and what that means if you're on a team where not
everyone has access to the same repos.

## What a token is, and why the app needs one

A Personal Access Token (PAT) is like a password created just for one app to use, instead of
handing it your real GitHub password. It's a long string you generate on GitHub and paste into
this app once (**GitHub** menu → **Connection Settings**). From then on, the app uses it to prove
"this request is authorized on behalf of this user" for anything it needs to do on GitHub.

Two things this app does need a token for:
- **Saving an aggregation set** — writing a file into this repo's `aggregation-data` branch.
- **Fetching a spec to aggregate** — reading a file from wherever an aggregation set points.

## The two tokens

Those are different capabilities — one is *write*, one is *read* — and this app lets you use two
separate tokens so you're never forced to grant more access than a given action needs:

| Field | Required? | What it's for | Access level |
|---|---|---|---|
| **Repo token** | Yes | Saving/editing/deleting aggregation sets | Read and write, on `swagger-editor-github` only |
| **Fetch token** | Only if a set references a *private* repo | Fetching spec content to aggregate | Read-only, on whichever repo(s) you're pulling specs from |

If you leave the fetch token blank, the app just reuses the repo token for fetching too — that's
fine as long as everything you aggregate is public (public repo content needs no token to read at
all) or you don't mind the repo token having read access to those repos as well. The fetch token
only earns its place once you want to keep those separate.

## Step-by-step: creating each token

Both start the same way:

1. On github.com, click your profile picture (top right) → **Settings**.
2. Scroll to the bottom of the left sidebar → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

Then they diverge:

### Repo token (required)

4. Give it a name, e.g. `swagger-editor-github repo token`.
5. Under **Repository access**, choose **Only select repositories** → select `swagger-editor-github`.
6. Under **Permissions** → **Repository permissions**, find **Contents** → set it to **Read and write**.
7. **Generate token**, copy it, and paste it into **Connection Settings → Repo token**.

### Fetch token (optional — only if you'll aggregate a private repo's spec)

4. Give it a name, e.g. `swagger-editor-github fetch token`.
5. Under **Repository access**, choose **Only select repositories** → select whichever private
   repo(s) you'll pull specs from.
6. Under **Permissions** → **Repository permissions**, find **Contents** → set it to **Read-only**.
7. **Generate token**, copy it, and paste it into **Connection Settings → Fetch token**.

**Why two separate tokens, rather than one covering both?** A fine-grained token applies one
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
