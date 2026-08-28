# Suggesting a pull request

This is a different feature from [aggregation](Aggregation.md) — aggregation merges several
independent specs together and loads the result into a tab. Suggesting a pull request goes the
other direction: it takes whatever's in **one** tab and proposes it back as a change to a single
file in a GitHub repo, via a real pull request. It doesn't touch the Aggregate menu or aggregation
set storage at all — any tab can be linked and suggested, whether or not it came from an
aggregation.

## Using it

1. Click the pull-request icon on a tab in the tab bar, or use **File → Suggest pull request…**
   (which acts on whichever tab is currently active — same as `Convert to JSON`/`Convert to YAML`
   in the Edit menu). Both open the same modal.
2. **First time on this tab:** you'll land straight in a linking form — paste a GitHub file URL, or
   click **Browse GitHub repositories…** to pick one instead. See [Linking a tab](#linking-a-tab-to-a-repo-file)
   below.
3. Once linked, the modal checks the tab's content against the linked file and walks you through
   whatever's next: nothing to suggest, a drift warning, a diff preview, or (if the token can't
   write to that repo) why not. **Open pull request** does the rest.

## Linking a tab to a repo file

A tab links to exactly one file, in exactly one repo — not a whole aggregation set, not a folder.
Two ways to set it:

- **Paste a URL** — a `github.com/owner/repo/blob/ref/path` link (the one you'd copy from GitHub's
  own file viewer), a `raw.githubusercontent.com` link, or the equivalent on a configured GHEC/
  GHE.com custom domain are all recognized.
- **Browse GitHub repositories…** — the same repo browser used elsewhere in this app (e.g. the File
  menu's own **Browse GitHub repositories…** item), for when you don't have the URL handy.

Either way, the file is fetched once and that content becomes the tab's *baseline* — the "last
known upstream state" this feature compares against later (see [Drift detection](#drift-detection)
below). The link itself lives in this browser's `localStorage`, keyed by tab ID — it's local to
your browser, not saved anywhere shared. Closing a tab discards its link; duplicating a tab copies
it, since a duplicate is meant to be a copy of everything about the original, including where it's
already linked.

Already linked and want to point the tab at a different file instead? The modal's footer always has
a **Link to repository file** button (except on the success screen, where there's nothing left to
re-link for) that reopens this same form — now showing the currently-linked URL as the input's
placeholder, and spelled out in full underneath it, so you can see what's already set before typing
a new one.

## Drift detection

Before diffing anything, the modal re-fetches the linked file fresh and compares it against the
baseline. If nobody else has touched the file upstream since you linked (or last refreshed), it
proceeds straight to the diff preview. If it has changed, you'll see:

> This file changed since you started editing — review before we open a PR.
>
> First difference at line _N_ (_X_ lines you started from vs. _Y_ lines upstream now).

**Continue anyway** proceeds using the fresh content as the new base for the diff/commit, and also
updates the saved baseline to match — so acknowledging the drift once doesn't mean seeing the same
warning again on your next attempt if nothing else has changed.

If the tab's content is identical to the fresh upstream content, there's nothing to suggest and the
modal says so rather than offering an empty PR.

## Format conversion

The suggestion always matches the **linked file's** format, not necessarily the tab's. If you've
been editing YAML but the linked file is `.json` (or vice versa), the content is automatically
converted before it's committed — you don't need to convert it yourself first.

## Reviewing the diff

Once there's a real change to suggest and the connected token can write to the target repo, you get
a preview: a `+added -removed` line count, then a line-by-line diff (a real LCS-based diff, not just
a summary). Very large files (beyond 4,000 lines on either side) skip the line-by-line view — you
still get a plain statement that the change will be committed as shown, just without rendering
thousands of lines in a modal.

## Opening the pull request

**Open pull request** does three things against the target repo, in order:

1. Creates a new branch off the linked file's base branch, named
   `swagger-editor-suggestion-<timestamp>-<random>` so it's obviously distinct from a manually
   created branch.
2. Commits just that one file's new content to it, with commit message `Update <path> via Swagger
   Editor`.
3. Opens a pull request from that branch back to the base branch, titled `Update <path>`.

On success you get a chip linking straight to the new PR. The tab's baseline is updated to the
content the base branch actually had at that moment — not the suggestion itself, since the
suggested content only exists on the new branch until the PR is merged. That keeps the next drift
check comparing against what upstream genuinely has, rather than misreporting a huge "drift" for a
PR that just hasn't merged yet.

## Permissions

Suggesting a pull request always needs a classic personal access token with write access — same
requirement as saving an aggregation set, just checked against whichever repo the tab happens to be
linked to instead of this app's own repo. If the connected token can read but not write to that
repo, the modal tells you so instead of offering a preview. See [Permissions.md](Permissions.md)
for how to create a token and what "write access" means for a repo you don't own directly (e.g. via
a fork).
