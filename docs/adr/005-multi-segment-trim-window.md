# ADR 005 — Trim becomes a multi-segment timeline window

Date: 2026-08-13 · Status: accepted

## Context

V6/A2 shipped as `GOALS.md` specified: a "mini window" with a start box, an end box and a
lossless checkbox. It works, but it is the only Core action where the user cannot see what
they are operating on. Every tool this action exists to replace — online audio cutters,
browser video trimmers — puts the media on screen and lets you drag the cut. Typing
`1:32.5` into a text box and hoping is not a replacement for that.

Two limits followed from the same design: one cut per invocation, and no way to preview the
result before committing to a re-encode. Removing three ad breaks from a recording meant
running the action three times and then running Merge videos over the pieces.

## Decision

The Trim window becomes a timeline editor. `GOALS.md` V6/A2 were amended first (v1.2
amendment, separate commit) as CLAUDE.md requires.

### 1. Segments are the wire format; "remove" never crosses the boundary

Options gain `segments` (`"1.5-3.2,10-12.75"`, seconds, keep-regions) and `mode`
(`merge` | `separate`). The Keep/Remove toggle is resolved **inside the window** —
Remove-mode regions are inverted against the duration before submit — so `buildPlan`
sees exactly one meaning and stays pure. Legacy `start`/`end` remain accepted, which keeps
`smoke`, `--opt`, and the existing golden plans working unchanged.

A single segment in merge mode emits byte-identical output to the old plan, so
`test/golden/trim-video.json` and `trim-audio.json` are untouched regression anchors.

### 2. Cut-then-concat, not one filter_complex pass

N segments become N `-ss/-to` cut steps plus a `write-text` list and a concat-demuxer step —
the same pair `mergeVideos` already uses. The alternative (`trim`/`atrim` + `concat` filter in
a single pass) is frame-accurate too, but it decodes the entire source once no matter where
the cuts are; fast-seeking each segment is dramatically quicker on a long file with short
cuts. Segments share one source and one encoder setting, so the demuxer's "identical
parameters" precondition holds in both lossless and re-encode mode.

The concat list uses **bare relative filenames** (`file 'seg-0.mp4'`), which the demuxer
resolves against the list file's own directory. `mergeVideos` writes `{tmp}/…` tokens and
escapes quotes on the *token* — but Rust substitutes the real path afterwards, so a `%TEMP%`
path containing an apostrophe would break it. Relative names sidestep the problem entirely.

### 3. Playback via the asset protocol, previews built on demand

`app.security.assetProtocol.enable` is turned on with an **empty static scope**; the file
under edit is allowed individually at window-open time via `asset_protocol_scope().allow_file`.
The CSP is widened by hand (Tauri does not auto-patch it for `asset:`) to permit
`asset: http://asset.localhost` in `media-src` and `img-src`.

WebView2 decodes mp4/m4v/mov/webm and mp3/m4a/wav/ogg/opus, but not mkv, avi, wmv, flv, ts,
mts, 3gp or wma. Rather than a codec table that will drift, the window simply *tries* to play
the source and listens for the `error` event. On failure it offers a **Build preview** button
that transcodes a 360p/24fps proxy with progress and cancel. Editing works without it — the
filmstrip and waveform are still there — so the wait is opt-in and never blocks a cut.

Always building a proxy was rejected: it would tax the common mp4/mp3 case, which plays
natively and instantly, to smooth over the rare one.

### 4. Timeline pre-passes

Two cheap FFmpeg passes on window open: a 40-tile filmstrip (`fps=40/duration,scale,tile=40x1`,
the contact-sheet trick from V9) for video, and a `showwavespic` PNG for anything with audio.
Fixed tile count means the cost does not grow with duration. Both land in
`%TEMP%\zapit\preview-*`, which the existing `sweep_stale_temp` already collects.

## Addendum (2026-08-13) — `zapitmedia://` replaces the asset protocol

Testing found M4A files would not play in the window while WAV played fine.

Tauri's asset protocol sets Content-Type from `tauri_utils::mime_type::MimeType::parse`,
which sniffs magic bytes with the `infer` crate. For an M4A, `infer` returns **`audio/m4a`**
(`infer-0.19.0/src/map.rs:288`) — a string no browser engine recognises. Chromium's media
pipeline accepts only `audio/mp4` and `audio/x-m4a`, so WebView2 refused the file outright.
WAV worked because its sniffed type happens to be one Chromium knows. The header is not
overridable, so the built-in protocol cannot serve this app's own format catalog.

Section 3 above is therefore superseded: the asset protocol is **off** (`protocol-asset`
feature dropped, `assetProtocol` config removed) and `src-tauri/src/media_protocol.rs`
registers `zapitmedia://` instead. It maps extension → a MIME type the engine accepts,
implements HTTP range requests (seeking is the whole point of a trim window) and caps any
single response at 1 MB so a two-hour film never lands in memory.

The security posture is unchanged in spirit and simpler in practice: instead of an empty
`FsScope` plus per-file `allow_file` calls, `JobState.allowed_media` is a deny-by-default
set of granted paths and the handler 403s anything not in it. The CSP drops `asset:` for
`http://zapitmedia.localhost`.

## Addendum (2026-08-13) — menu items moved out of the file class

Renaming the any-file verb (below) removed a real collision but did **not** restore the
missing entries. The flyout still stopped after "Video → GIF" — the first four entries — with
Trim, Merge, Mute, Extract frame, Make editing-friendly, Downscale and Checksum absent,
even though all eleven were present in the registry with valid commands.

The cause is a Windows shell ceiling: Explorer honours roughly **16 static verbs per file
class**, and a preset is a verb. Counting `.mp4`:

| entry | own verbs | running total |
|---|---|---|
| `010_extract-audio` | 1 | 1 |
| `030_compress-video` | 1 + 7 presets | 9 |
| `040_convert-video` | 1 + 4 presets | 14 |
| `050_video-to-gif` | 1 + 3 presets | **18** |
| `060_trim-video` … | … | 34 |

The cut lands exactly where the running total crosses 16, which is precisely the boundary
users reported. Preset submenus (added in the §7.3 follow-up) are what pushed it over;
before them the menu fit.

Fix: the file-class verb now carries **`ExtendedSubCommandsKey`** instead of `SubCommands`,
pointing at a class of our own (`Zapit.Menu.<ext>`, and `Zapit.Menu.<ext>.<action-id>` for a
preset flyout). Verbs in those classes do not count against the file class, which is left
holding exactly one. This is the same mechanism Windows uses for its own large cascading
menus. `install`/`uninstall` sweep every class under the `Zapit.Menu` prefix, which is
wholly ours, so the operation stays idempotent.

The lesson worth keeping: the registry containing an entry is not evidence that Explorer
will draw it. Two rounds of diagnosis assumed otherwise.

## Addendum (2026-08-13) — the any-file verb needed its own key name

Most video actions were missing from the right-click menu even though the registry
contained them. Two verbs applied to the same file and **both were named `Zapit`**:
`HKCU\…\Classes\*\shell\Zapit` (any-file, holding only Checksum) and
`HKCU\…\Classes\SystemFileAssociations\.mp4\shell\Zapit` (the ten video actions). Explorer
dedupes context-menu verbs by key name, so one flyout shadowed the other.

Two changes: the any-file class now writes `ZapitAnyFile` (display text still comes from
`MUIVerb`, so both read "Zapit"), and any-file actions are additionally folded into every
extension's own flyout — a video's menu no longer depends on two verbs coexisting.
`install`/`uninstall` sweep the legacy `*\shell\Zapit` key, which uninstall would otherwise
never match and which would keep shadowing menus forever.

## Consequences

- Trim is now the most complex window in the app. It is split into `timeline.ts`, `player.ts`
  and `preview.ts` so no file exceeds the §12 size bar; `main.ts` is wiring only.
- `gather_options` gained a per-window size table — 420×240 non-resizable was fine for a
  prompt, not for a player. Other windows keep the old default.
- The asset protocol is enabled process-wide. The static scope stays empty and allowances are
  per-file, so this does not become a general filesystem read primitive for the webview.
- Lossless + multiple segments stitches keyframe-aligned pieces, which can show timestamp
  seams. Precise re-encode remains the default and the lossless checkbox says "approximate".
- `Cargo.toml` pins the `protocol-asset` feature explicitly even though enabling it in
  `tauri.conf.json` selects it automatically — the dependency should be readable without
  cross-referencing the config.
