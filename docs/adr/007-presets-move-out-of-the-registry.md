# ADR 007 — Presets leave the registry; one verb per action

Date: 2026-08-13 · Status: accepted · Supersedes the menu sections of ADR 005's addenda

## Context

Most of the app was unreachable from the context menu. Right-clicking an `.mp4` showed
Extract audio, Compress video, Convert to and Video → GIF — then nothing. Trim, Merge videos,
Mute video, Extract frame, Make editing-friendly, Downscale to and Checksum were all missing,
despite being present in the registry with valid command lines pointing at the installed exe.

Three fixes shipped against this and none worked. What they got wrong is worth recording,
because each looked correct from the registry:

1. **Duplicate verb name.** `*\shell\Zapit` and `SystemFileAssociations\.mp4\shell\Zapit`
   both applied to a video. Renaming the any-file one to `ZapitAnyFile` removed the
   collision — and produced **two "Zapit" entries** in the menu. Explorer's
   dedupe-by-key-name was load-bearing, not a bug.
2. **`ExtendedSubCommandsKey`.** The documented way to move items into their own class.
   The registry looked perfect. Explorer **ignores it under `SystemFileAssociations`**;
   only `SubCommands=""` plus an own `shell` subkey is honoured there.
3. **Association cache.** `SHChangeNotify(SHCNE_ASSOCCHANGED)` was genuinely missing and is
   genuinely required, but adding it did not change what rendered.

The actual cause is a shell ceiling: **Explorer honours roughly 16 static verbs per file
class, and a preset submenu entry is a verb.** `.mp4` registered 34:

| entry | own verbs | running total |
|---|---|---|
| `010_extract-audio` | 1 | 1 |
| `030_compress-video` | 1 + 7 presets | 9 |
| `040_convert-video` | 1 + 4 presets | 14 |
| `050_video-to-gif` | 1 + 3 presets | **18** |
| `060_trim-video` … | … | 34 |

The menu stops exactly where the running total crosses 16. Confirmed empirically by
rebuilding `.mp4`'s keys by hand as 12 flat verbs — all eleven actions then rendered.

Preset submenus arrived in the §7.3 follow-up. Before them the menu fit; they pushed it over.

## Decision

**One registry verb per action. Presets move into a window.**

- The file-class verb keeps `SubCommands=""` and its own `shell` subkey — the only cascading
  form that works here. `ExtendedSubCommandsKey` and the `Zapit.Menu.*` classes are gone,
  and `install`/`uninstall` sweep them so an upgrade cleans up after the failed attempt.
- Both the `*` class and every per-extension class use the key name `Zapit` again, so
  Explorer dedupes them into a single entry. Any-file actions (G1 Checksum) are folded into
  every extension's flyout, so nothing depends on two verbs coexisting.
- A preset-bearing action's command line carries `--opt menu=1`. `bridge.ts` sees that as
  the *only* option and answers `NeedsOptions("presets")`; `presets.html` lists the choices
  and submits the chosen options plus `preset=<index>`.

`.mp4` now registers 12 verbs (1 parent + 11 actions) instead of 34.

### Why a marker rather than "no options ⇒ show presets"

`smoke` invokes `heic-convert` and `gif-to-video` with no `--opt` at all and expects them to
run headlessly. Keying off emptiness would have broken the suite. `menu=1` is only ever
written by the registry writer, so CLI and `smoke` behaviour is untouched.

### Why a third options round

`preset=<index>` is always sent even when a preset carries no options of its own
("At a time…", "Custom size…"), so the reply is never empty and cannot bounce back to the
same window. Those presets then throw their own `NeedsOptions`, making the flow
presets → detail prompt → plan. The loop in `jobs.rs` allows two option round-trips.

## Consequences

- Five actions per file type cost one extra click. §7.3 wanted presets without dialogs; that
  is not purchasable within the verb ceiling, and an unreachable action is worse than an
  extra click.
- The preset window is generic — it reads `presets` off the action registry — so adding a
  preset to any action needs no window work.
- `scripts/test-presets.ps1` walks the flat layout again and still fails loudly on an empty
  sweep.
- **Diagnostic lesson.** A registry entry existing is not evidence Explorer will draw it.
  `Shell.Application`'s `Verbs()` cannot see cascading menus either — it lists plain verbs
  only — so it cannot confirm this. A screenshot of the open menu settled in one message
  what three rounds of registry inspection could not. Ask for one first.
