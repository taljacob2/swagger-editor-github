# Getting Started

This page answers one question: **do you need to fork this repo, or can you just use the hosted
site?** It builds on the four permission tiers from [docs/Permissions.md](Permissions.md) — read
that first if you haven't, since it explains what each tier actually means and how to get a token
for it. This page only adds the "where do I run this from" dimension on top.

## Quick answer

| You're on... | Tier 0 (public, browse-only) | Tier 1 (read-only, private content) | Tier 2 / 3 (maintainer — create/edit/delete sets) |
| --- | --- | --- | --- |
| **github.com** | Use the hosted site | Use the hosted site | **Fork required** |
| **GitHub Enterprise Cloud** (custom domain) | Use the hosted site | **Fork required** | **Fork required** |

The hosted site is: **https://taljacob2.github.io/swagger-editor-github/**

Why maintainer tiers always need a fork, regardless of host: saving a set means writing to *this
app's own repo* (its `aggregation-data` branch — see [Design.md](Design.md#aggregation-set-storage)),
and nobody but the owner has write access to `taljacob2/swagger-editor-github`. Forking gives you a
copy of the app backed by a repo you actually control, so a write-scoped token works.

Why GHEC + Tier 1 also needs a fork: the API base URL (`api.github.com` vs. your org's GHEC API
host) is a per-deployment setting. A fork deployed on your own GitHub Pages lets you bake your
org's API host in at build time (see [below](#deploying-your-fork-with-github-pages)) and keeps
everything — traffic, tokens, SSO — inside domains your org has already approved, rather than
asking your org's private data to round-trip through a page hosted on someone else's github.com
account.

## Using the hosted site (no fork needed)

If you're in the top-left or top-right cell above, there's nothing to install. Open
[the hosted site](https://taljacob2.github.io/swagger-editor-github/), and if you need a token,
follow [docs/Permissions.md](Permissions.md) to create one and paste it into **GitHub →
Connection Settings**.

## Forking

### On github.com

Use GitHub's own fork button: open
**[github.com/taljacob2/swagger-editor-github](https://github.com/taljacob2/swagger-editor-github)**
and click **Fork** (top right). That's it — GitHub creates `<your-account>/swagger-editor-github`
for you, ready for the deploy step below.

### On GitHub Enterprise Cloud

GHEC instances don't fork across from github.com directly, so instead you clone this repo and push
it up as a brand-new repository inside your GHEC organization:

```bash
git clone --bare https://github.com/taljacob2/swagger-editor-github.git
cd swagger-editor-github.git
git push --mirror https://YOUR-GHEC-HOST/YOUR-ORG/swagger-editor-github.git
rm -rf ../swagger-editor-github.git  # optional cleanup of the temporary bare clone
```

(Replace `YOUR-GHEC-HOST`/`YOUR-ORG` with your enterprise's actual hostname and organization.) This
gives you a full copy of the repo, including history, sitting in a repo you have push access to —
functionally equivalent to a fork for everything this app needs.

## Deploying your fork with GitHub Pages

The repo already ships a working deploy workflow —
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml) — so deploying is
configuration, not code:

1. **Repo visibility.** On a free personal github.com account, Pages requires a **public** repo.
   On GitHub Team/Enterprise (including GHEC), Pages works for private repos too — check your
   plan's Pages settings if you want to keep the fork private.
2. **Allow Pages to deploy from GitHub Actions.** This is a prerequisite, not just a preference —
   on some organizations/enterprises, an org or enterprise admin must first allow GitHub Pages
   sites (and specifically the **GitHub Actions** build source) at the org/enterprise policy level
   before an individual repo can use it at all. Once that's allowed, go to your fork's own
   **Settings → Pages**, and under **Build and deployment → Source**, choose **GitHub Actions**. If
   that option isn't available, ask your GHEC admin to enable it rather than assuming the repo is
   misconfigured.
3. *(GHEC only, optional but recommended)* **Set your org's API host.** Go to **Settings → Secrets
   and variables → Actions → Variables**, and add a repository variable named
   `GH_API_BASE_URL` set to your GHEC API host (e.g. `https://api.your-ghec-domain.com`) — GitHub
   Actions rejects any variable name starting with `GITHUB_`, which is why this one isn't named
   `GITHUB_API_BASE_URL` even though the app's own build-time env var is. This gets baked into the
   build as the default API base URL, so your visitors don't have to type it into Connection
   Settings by hand. Left unset, it defaults to `https://api.github.com` — correct for plain
   github.com forks, so skip this step there.
4. *(GHEC only, and only if you publish the site **privately**)* **Set the Pages base path to
   `/`.** By default the workflow builds the app with `--base=/<your-repo-name>/`, which matches
   how a normal, publicly published Pages project site is served: `https://<org>.github.io/<repo>/`.
   A **privately** published Pages site on GHEC instead gets its own unique per-repo subdomain and
   is served at that subdomain's *root* — no `/<repo-name>/` prefix. If you build with the wrong
   base for your deployment, every JS/CSS/media request 404s, which GitHub Pages answers with its
   HTML 404 page — showing up in the browser console as MIME-type/`nosniff` errors on every static
   asset (`"blocked due to MIME type ('text/html') mismatch"`). To fix it, add a repository
   variable named `PAGES_BASE_PATH` (same **Settings → Secrets and variables → Actions →
   Variables** page as above) set to `/`. Leave it unset for a publicly published project site.
5. **Push to `main`.** The workflow triggers automatically on every push to `main` (it's also
   available as a manual `workflow_dispatch` run from the **Actions** tab). It builds the app with
   `--base` set to `PAGES_BASE_PATH` if you set one, otherwise `/<your-repo-name>/` — derived
   automatically from the repo name, so this works unmodified whatever you rename your fork to —
   and deploys the result to Pages.
6. **Find your URL.** Once the `deploy` job finishes, the **Actions** run summary and **Settings →
   Pages** both show the live URL — normally `https://<your-account-or-org>.github.io/<repo-name>/`
   for a public project site, or your unique `https://<subdomain>.pages.<your-ghec-host>/` for a
   privately published GHEC site.

From there, aggregation-set storage defaults to your fork's own `aggregation-data` branch — nothing
else to configure. See [Design.md](Design.md) for the full architecture if you want to go deeper.

## Keeping your fork up to date

This repo has no formal release process yet (see [Design.md](Design.md#progress) for what's still
in progress). To pull in upstream changes:

```bash
git remote add upstream https://github.com/taljacob2/swagger-editor-github.git
git fetch upstream
git merge upstream/main
git push origin main
```

A push to `main` re-triggers the deploy workflow automatically, so an updated fork redeploys
itself with no extra steps.
