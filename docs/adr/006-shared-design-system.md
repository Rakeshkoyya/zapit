# ADR 006 — One design system, and Settings becomes a real settings app

Date: 2026-08-13 · Status: accepted

## Context

Every one of the fourteen windows carried its own `<style>` block, each re-declaring
`color-scheme`, `font-family: "Segoe UI"`, a font size, and its own button and input
padding. Nothing was shared, so nothing was consistent: buttons were `4px 14px` in one
window and `3px 12px` in the next, dialogs put their primary action in a different place
depending on which file you happened to open, and a change to the look of the app meant
fourteen edits.

The Settings window suffered worst, and it is the window a new user meets first — the
installer opens it. It presented, in a 560px column: a bare `Add to right-click menu`
button, three unexplained radio buttons, and thirty-one bare checkboxes labelled only with
their menu text (`Convert to`, `Trim…`, `Compress`). Nothing on the page said what any
action did, which files it would appear on, or where in Windows to look for the menu it had
just installed. The user's report was direct: "the page opens is not very understandable".

The `QuickAction` interface had no field for a human description, so the window had nothing
better to render even if it had wanted to.

## Decision

### 1. `src/ui/theme.css` is the single source of visual truth

Design tokens (surface, border, text, accent, danger, radius, shadow, easing) plus the
primitives every window needs: `.btn` and its variants, `.field`, `.switch`, `.chip`,
`.card`, `.banner`, and a `.dialog` shell of fixed head / scrolling body / fixed action bar.
Each window's entry module imports it; Vite emits it once as a shared chunk (~7 kB).

Light and dark both come from `prefers-color-scheme`, so the app follows the Windows
setting rather than picking for the user.

Windows keep a small `<style>` block only for layout genuinely unique to them — the trim
timeline, the settings sidebar. The seven prompt dialogs are identical enough that they
share `src/ui/prompt.css` and now carry no styles of their own at all.

### 2. Action descriptions live beside the registry, not on `QuickAction`

`src/actions/descriptions.ts` maps action id → one plain-English sentence. It is deliberately
_not_ a field on `QuickAction`: the action modules stay purely about building plans (§5.1),
and a copy change does not touch thirty-one files.

The risk of a separate map is drift, so `test/unit/descriptions.test.ts` fails the build if a
menuable action has no description, or if a description names an action that no longer
exists.

### 3. Settings is four panes, not one column

- **Right-click menu** — install state as a sentence rather than a button label, the three
  steps to actually reach the menu (including that Windows 11 hides it behind _Show more
  options_), and a small drawing of that menu chain. This is the landing pane because it is
  what a just-installed user needs.
- **Actions** — each action is a switch, a description of what it does, and a chip per file
  extension it appears on, grouped by category with a per-group count and enable/disable, and
  a search box that matches labels, descriptions and extensions.
- **Saving results** — the three output policies as option cards with explanations, plus the
  folder picker for "always in one folder" that the config schema always had (`fixedDir`) but
  the UI never exposed.
- **About** — licences, log folder, and removing the menu.

The window grows to 880×700 and becomes resizable; the other dialogs are sized per window
rather than all sharing one 420×240 box that the new layouts overflow.

### 4. Toggling an action no longer installs the menu

Previously every checkbox change called `apply_menu`, which would write the registry even if
the user had never added Zapit to it. Now the config is always saved, and the registry is
only rewritten when the menu is actually installed.

## Consequences

- One place to change the look of the app; fourteen windows follow.
- A new action needs a description or the test suite fails — intentional friction, since an
  undescribed action is invisible to the user in Settings.
- The verb-limit work from the previous fix is unaffected: the UI says nothing about limits
  because `registry_menu.rs` writes one verb per file class and hangs the items off
  `ExtendedSubCommandsKey`, so there is no limit for the user to manage.
- No IPC command, config field, or action plan changed. The golden plans are untouched.
