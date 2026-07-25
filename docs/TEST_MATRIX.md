# Test Matrix

Two kinds of coverage:

- **Automated** — `scripts/smoke.ps1` (headless, real conversions) plus vitest/cargo unit
  and golden-plan tests. Re-run on every milestone; this table records what each action's
  automated run proves.
- **Manual** — the GOALS.md Definition of Done items a script cannot check (Explorer
  integration, toasts, no console flash, clean-machine install). Filled in at **M6** (shell)
  and re-run in full at **M7** (release) on a clean Windows 11 machine.

Last automated run: **2026-07-25**, all green (`smoke.ps1` 40 cases + `-Heavy` 9 cases).

## Automated coverage per action

| Action | Smoke case(s) | Adversarial input covered |
|---|---|---|
| V1 extract-audio | `v1-extract-audio`, `v1-unicode`, `v1-no-audio-fails`, `heavy-v1-2gb` | unicode+spaces filename, no-audio UserError, **2.2 GB** file |
| V2 remux-mp4 | `v2-remux-vfr` | **VFR** screen-recording-style MKV |
| V3 compress-video | `v3-compress-quality`, cancel test | mid-encode cancel on a 2.2 GB file |
| V4 convert-video | `v4-convert-mkv` | remux fast path (stream copy) |
| V5 video-to-gif | `v5-gif` | two-pass palettegen |
| V6 trim-video | `v6-trim` | precise re-encode path |
| V7 merge-videos | `v7-merge-uniform` | concat-demuxer path (unit test covers the filter fallback) |
| V8 mute-video | `v8-mute` | unit test covers the no-audio refusal |
| V9 extract-frame | `v9-frame`, `v9-sheet` | single frame + 4×4 contact sheet |
| V10 editing-friendly | `v10-editing` | VFR source → CFR all-intra |
| V11 downscale-video | `v11-downscale`, `v11-refuses-upscale` | refuses to "downscale" a smaller video |
| V12 gif-to-video | `v12-gif-to-mp4` | odd-dimension GIF → even-dimension yuv420p |
| A1 convert-audio | `a1-convert-wav` | unit test covers the same-format refusal |
| A2 trim-audio | `a2-trim-copy` | mp3 stream-copy cut |
| A3 normalize-audio | `a3-normalize` | two-pass loudnorm JSON round-trip |
| A4 merge-audio | `a4-merge-audio` | mixed codecs (mp3 + flac) → filter path |
| A5 boost-volume | `a5-boost` | unit tests cover factor validation |
| I1 convert-image | `i1-convert-png-jpg`, `i1-convert-ico` | alpha flattening, multi-size ICO |
| I2 resize-image | `i2-resize-cm-dpi` | cm@dpi spec with DPI metadata |
| I3 compress-image | `i3-compress-50kb`, `i3-under-target`, `heavy-i3-*` (5 photos) | **48 MP** photo, odd dimensions, portrait, square, gradient — all ≤ target |
| I4 heic-convert | `i4-heic-jpg` | real iPhone-style HEIC |
| I5 images-to-pdf | `i5-images-to-pdf` | JPEG + transparent PNG (flattened) |
| I6 view-metadata | `i6-strip-metadata` | strip path (`-map_metadata -1`, pixels untouched) |
| I7 svg-to-png | `i7-svg-png` | vector → 512 px raster |
| P1 merge-pdf | `p1-merge`, `p1-merge-encrypted-fails` | encrypted input → UserError |
| P2 split-pdf | `p2-split` | full grammar `1-3,7,9-` → 3 files |
| P3 compress-pdf | `p3-compress`, `p3-under-target-and-valid`, `p3-encrypted-fails`, `heavy-p3-big-mixed` | **29 MB** mixed PDF → 711 KB, `qpdf --check` valid |
| P4 pdf-to-images | `p4-pdf-images` | runtime-determined page count |
| P5 pdf-extract-text | `p5-extract-text`, `p5-scanned-fails` | scanned PDF → honest "no text" message |
| P6 protect/unlock | `p6-protect`, `p6-unlock`, `p6-wrong-password-fails` | wrong password → UserError, no retry loop |
| G1 checksum | rust unit test (known SHA-256/MD5 vectors) + end-to-end run | constant-time compare unit-tested |

## Menu preset sweep — `scripts/test-presets.ps1`

Installs the menu, reads every command line back out of the registry, and runs each one
headlessly against a sample file of the matching type. This is the closest unattended
equivalent of right-clicking everything.

Last run: **2026-07-25 — 462 passed, 0 failed, 96 skipped (of 558 entries).**

Skipped entries are the ones that cannot run unattended by design: "Custom…" entries that
open a prompt window, and multi-file actions (merge, images→PDF) that need more than one
`%1`. Both are covered by unit tests instead.

Bugs this sweep caught before release:

| Bug | Fix |
|---|---|
| "Compress video" always targeted 25 MB — no menu entry ever passed an option | Preset flyouts; `run` accepts `--opt`; silent defaults removed |
| "Convert to…" on audio showed an error toast with no way to choose a format | Preset flyout per format |
| "Extract frame at 30 s" on a 5 s clip failed with "could not place output" | Timestamp validated against duration; presets made relative (First/Middle) |
| GIF → PNG/JPG failed with an FFmpeg exit code | Animated sources take the first frame (`-frames:v 1 -update 1`) |
| A step exiting 0 but writing nothing gave a baffling "file not found" | Clear message: "That produced no output…" |
| Changing the app icon left the **old icon embedded in the exe** — the compiled resource is cached and Cargo does not track `icon.ico` as an input | Stale `target/*/build/zapit-*` dirs are deleted before rebuilding; verified with `ExtractIconEx`, not Explorer (which caches per path) |

## Definition of Done — manual checklist (M6/M7)

Run on a **clean Windows 11 machine**, not the dev box.

### Shell integration (M6)
Automated by `scripts/test-menu.ps1` unless noted.
- [x] Verb keys written for every category + the any-file (`*`) class; flyout shape
      (`SubCommands` present) and `command` line verified
- [x] `MultiSelectModel=Player` written for every multi-file action
- [x] Invoking the registered command line (exactly as Explorer does) produces output
      next to the source; 3 concurrent invocations aggregate into one job
- [x] Install and uninstall are both idempotent (run twice, no errors)
- [x] Registry export before install and after uninstall is identical (zero residue)
- [ ] **Manual:** entries visible under right-click → Show more options in Explorer
- [ ] **Manual:** multi-select of **> 15 files** does not prompt or truncate
- [ ] **Manual:** Settings toggle removes an entry from the live menu

### Installer (M7) — automated by `scripts/test-install.ps1` on the dev machine
- [x] Installer ≤ 100 MB (83.9 MB) and installs per-user without admin rights
- [x] Sidecars bundled as resources and used by the installed copy
- [x] Post-install hook registers the menu; pre-uninstall hook removes it
- [x] Installed copy runs actions on unicode filenames and hits KB targets
- [x] Running the same job twice produces `(2)` instead of overwriting
- [x] No temp garbage in `%TEMP%\zapit` afterwards
- [x] Uninstall removes the app directory, the menu keys, and leaves the registry
      byte-identical to before the install

### Per-action DoD (M7)
For each shipped action, on 3 real files including one adversarial:
- [ ] Output correct and openable
- [ ] Filename with spaces + non-English characters (`मेरा वीडियो (final) 2.mp4`)
- [ ] Output naming never overwrites (run twice → `(2)`)
- [ ] Cancel mid-job leaves no temp garbage in `%TEMP%\zapit`
- [ ] No console window flash at any point
- [ ] > 2 GB video for the video actions

### Clean-machine pass (M7) — **not yet done**
Everything above was verified on the development machine. The Definition of Done requires
repeating it on a clean Windows 11 machine or VM:
- [ ] Installer runs on a machine that has never had the toolchain or sidecars
- [ ] SmartScreen behaviour observed and documented (the build is unsigned)
- [ ] Explorer menu appears and works for each category
- [ ] `%APPDATA%\Zapit` (config + logs) after uninstall: keep or remove — decide and document
