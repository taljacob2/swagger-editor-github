# Keyboard Shortcuts

All tab-management shortcuts use **Alt**, act on the active tab (or a specific tab, for the
number keys), and are registered on the capture phase in
[`TabBar.jsx`](../swagger-editor/src/plugins/workspace-tabs/components/TabBar/TabBar.jsx) so they
fire regardless of whether focus is in the Monaco editor, a tab-rename field, or elsewhere on the
page. Undo/redo use **Ctrl** (**Cmd** on macOS) and are scoped to the Monaco editor itself.

## Tabs

| Shortcut | Action |
| --- | --- |
| `Alt+1` … `Alt+9` | Jump directly to tab 1–9 (no-op if that tab doesn't exist) |
| `` Alt+` `` | Switch to the next tab, wrapping from the last tab to the first |
| `Alt+~` (i.e. `Alt+Shift` + backtick) | Switch to the previous tab, wrapping from the first tab to the last |
| `Alt+T` | Open a new blank tab and activate it |
| `Alt+Q` | Close the active tab (no-op if it's the only tab remaining) |
| `Alt+S` | Duplicate the active tab and activate the copy |
| `Alt+X` | Rename the active tab (same inline edit field as double-clicking its name) |

Tabs can also be **dragged** by their name to reorder them — drop on the left or right half of a
target tab to place the dragged tab before or after it. The active tab and its content are
untouched by a reorder; only the tab order (persisted to `localStorage`) changes.

## Editor undo/redo

Undo/redo history is captured per edit (not on a timer) and persisted to `localStorage` per tab,
so it survives a page reload — see
[`undo-history.js`](../swagger-editor/src/plugins/editor-monaco/undo-history.js). Each tab has its
own independent history.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Z` (`Cmd+Z`) | Undo |
| `Ctrl+Y` (`Cmd+Y`) | Redo |
| `Ctrl+Shift+Z` (`Cmd+Shift+Z`) | Redo (alternate binding) |

## Command palette

| Shortcut | Action |
| --- | --- |
| `F1` | Open Monaco's Command Palette (unmodified default binding) |

The palette includes a **Resolve document** command that dereferences every `$ref` in the active
tab — including refs into other files — and replaces the editor content with the expanded spec.
See [docs/ResolvingReferences.md](ResolvingReferences.md) for this and two other ways to get a
fully resolved spec.

## Notes for contributors

- The tab shortcuts are letter-based (`T`/`Q`/`S`/`X`) rather than following a strict mnemonic
  (e.g. `R` for rename), because `Alt+<letter>` combos can be silently claimed by the OS, browser
  chrome, or Monaco's own keybinding service before ever reaching the page — `Alt+R` in particular
  turned out to be unreachable for some users even after moving the listener to the capture phase,
  which is why rename ended up on `Alt+X` instead. Pick a new letter carefully if you add a
  shortcut, and prefer testing it across a couple of real browsers/OSes over assuming it's free.
- `PageUp`/`PageDown` were the original bindings for next/previous tab; they were replaced with
  `` ` ``/`~` because not all keyboards (especially laptops) have dedicated Page Up/Down keys.
