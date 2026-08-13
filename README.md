# Zapit

**Right-click any file on Windows 11 and instantly do the obvious thing with it.**

No app to open, no uploads, no "compress PDF online" browser tabs. Select file(s) →
right-click → **Show more options** → Zapit → pick an action. The output lands next to the
source file, which is never modified.

- **Fully offline & private** — no network calls, no telemetry, no accounts, ever
- **Per-user install** — no admin rights; uninstall leaves the registry exactly as it was
- **Never destructive** — outputs get collision-safe names (`video.m4a`, `video (2).m4a`)
- **Free and open source** (MIT)

Most actions open a submenu so you choose what you want rather than getting a guessed
default:

```
Zapit ▸ Compress video ▸ Best quality
                         Balanced
                         Smaller
                         Under 15 MB
                         Under 25 MB
                         Under 50 MB
                         Custom size…
```

Compressing never changes the resolution — 1080p in, 1080p out. Changing resolution is what
**Downscale to** is for.

## Every action

### 🎬 Video

Works on: mp4, mkv, mov, avi, webm, wmv, flv, ts, m4v, mts, 3gp

| Action | What it does |
|---|---|
| **Extract audio** | Pulls the audio out without re-encoding where possible — AAC becomes `.m4a`, MP3 stays `.mp3`. Falls back to MP3 when the codec has no natural container. |
| **Remux to MP4** | Rewraps to `.mp4` in seconds, no quality loss. The "fix my OBS recording" button. Refuses (and points at Convert) if the codecs can't live in MP4. |
| **Compress video** | Best quality / Balanced / Smaller, or a size target of 15/25/50 MB or your own number. Resolution is always preserved. |
| **Convert to** | MP4, MKV, WebM or MOV. Copies streams instead of re-encoding whenever the target container allows it, so it's often instant. |
| **Video → GIF** | Two-pass palette generation for good colours at a sane size. Small / Medium / Large presets. |
| **Trim** | A timeline window: watch the clip, drag cut regions over a filmstrip and waveform, and press Play to hear the result before committing. Make as many cuts as you like, then merge them into one file or export each separately. A Keep/Remove toggle covers both "give me these bits" and "cut the ads out". Precise by default; a "lossless" checkbox cuts at the nearest keyframe with no re-encode. |
| **Merge videos** | Select several → order them → one file. Lossless concat when the clips match, automatic normalisation when they don't. |
| **Mute video** | Strips the audio track, no re-encode. |
| **Extract frame** | First frame, middle frame, a 4×4 contact sheet, or any timestamp you type. |
| **Make editing-friendly** | Turns variable-frame-rate screen recordings into constant-rate, all-keyframe footage that scrubs properly in editors. |
| **Downscale to** | 1080p, 720p or 480p. Refuses to "downscale" something already smaller. |
| **GIF → video** | Turns a huge GIF into a small MP4 or WebM. |

### 🎵 Audio

Works on: mp3, wav, flac, m4a, aac, ogg, opus, wma

| Action | What it does |
|---|---|
| **Convert to** | MP3, WAV, FLAC, M4A or OGG. Says so instead of pointlessly re-encoding when it's already that format. |
| **Trim** | The "online audio cutter" replacement, sharing the timeline window with video — waveform instead of filmstrip, multiple cuts, merge or export separately. MP3 and FLAC cut without re-encoding. |
| **Normalize loudness** | Proper two-pass EBU R128 normalisation (broadcast standard), not just a volume bump. |
| **Merge audio** | Several files → one, in the order you choose. |
| **Boost volume** | 1.5×, 2× or 3×. |

### 🖼️ Image

Works on: png, jpg/jpeg, webp, bmp, tiff, gif, heic/heif (svg for SVG → PNG)

| Action | What it does |
|---|---|
| **Convert to** | PNG, JPG, WebP, or a proper multi-size ICO (256/48/32/16 in one file). |
| **Resize to exact spec** | Understands `50%`, `800x600`, `800w` and `3.5x4.5cm@200dpi` — the way government forms actually phrase it, DPI metadata included. |
| **Compress to target size** | Type a KB number and it searches quality and dimensions until the file genuinely fits. Presets for 20/50/100/200/500 KB. Tested down to 50 KB from a 48-megapixel photo. |
| **HEIC → JPG** | Fixes iPhone photos. Also does PNG. |
| **Images → PDF** | Several images → one PDF, in the order you pick. |
| **View & remove metadata** | Shows the EXIF table with GPS rows highlighted, and one button strips everything without touching the pixels. |
| **SVG → PNG** | Rasterises at 512, 1024 or 2048 px wide. |

### 📄 PDF

| Action | What it does |
|---|---|
| **Merge PDFs** | Several → reorder → one. |
| **Split / extract pages** | Range grammar `1-3,7,9-`; each comma group becomes its own PDF, named `report (pages 1-3).pdf`. |
| **Compress** | High quality keeps text selectable (lossless). Medium and Low turn pages into images for much smaller files. Or aim at 500 KB / 1 / 2 / 5 MB, or your own number. |
| **PDF → images** | One PNG per page at 72, 150 or 300 DPI. |
| **Extract text** | Text layer → `.txt`. If the PDF is scanned it says so honestly instead of handing you an empty file. |
| **Protect with password** | AES-256 encryption, with a confirm field. |
| **Unlock PDF** | Removes a password **you already know**. Not a cracker — a wrong password simply fails. |

### 🧾 Any file

| Action | What it does |
|---|---|
| **Checksum** | SHA-256 or MD5, streamed so huge files don't eat memory. The result window has a Copy button and a paste-to-compare field that verifies in constant time. |

### Multi-select

Select 20 photos and hit Compress: they become **one job, one progress bar, one summary
notification** — not 20 windows. Actions that combine files (Merge, Images → PDF) open a
reordering window first.

### What it deliberately won't do

No cloud anything, no YouTube downloading, no Office conversions (lightweight DOCX→PDF
produces garbage and destroys trust), no zip tools (Windows has those), and no top-level
Windows 11 menu placement — "Show more options" is the contract for v1.

## Status

All 32 actions are implemented and pass an automated suite that runs real conversions,
including a 2.2 GB video, a 48-megapixel photo and a 29 MB PDF. A registry-driven sweep
exercises all 558 clickable menu entries. The installer builds, installs, registers the
menu and uninstalls cleanly on the development machine.

**Not yet done:** the Definition-of-Done pass on a *clean* Windows 11 machine and the
manual Explorer checks (see `docs/TEST_MATRIX.md`). The build is unsigned, so SmartScreen
warns on first run — choose "More info" → "Run anyway", or build it yourself.

## Install

Download the installer from the releases page and run it. It installs per-user into
`%LOCALAPPDATA%\Zapit` and adds the menu automatically.

To turn individual actions off, or to add/remove the menu later, run **Zapit** from the
Start menu to open Settings.

## Build from source

Prerequisites: Rust (stable, MSVC), Node LTS, and VS 2022 Build Tools with the C++ workload.

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/fetch-sidecars.ps1   # FFmpeg, qpdf, ImageMagick, pdfium (pinned + SHA-256 verified)
npm run tauri dev                                                     # dev run
npm run tauri build                                                   # installer -> src-tauri/target/release/bundle/nsis
```

Checks and test suites:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/make-test-assets.ps1 # generate test fixtures (once, after cloning)
powershell -ExecutionPolicy Bypass -File scripts/check.ps1        # fmt, lint, typecheck, unit + golden tests, clippy
powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1        # real conversions over test/assets
powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1 -Heavy # + >2 GB video, 48 MP photo, cancel test
powershell -ExecutionPolicy Bypass -File scripts/test-menu.ps1    # registry install/uninstall + empty-diff proof
powershell -ExecutionPolicy Bypass -File scripts/test-presets.ps1 # runs every clickable menu entry for real
powershell -ExecutionPolicy Bypass -File scripts/test-install.ps1 # installer end-to-end
```

Test fixtures aren't committed — they're deterministic output of the pinned sidecars, so
generating them beats carrying ~10 MB of binaries in git.

## How it is built

Tauri v2 — Rust core, strict TypeScript frontend, no UI framework. The design idea worth
knowing: **every action is a pure function** that returns a plan (a list of FFmpeg / qpdf /
ImageMagick argument arrays and engine calls) rather than running anything itself. Rust
executes plans. That makes every action unit-testable against a checked-in golden JSON file
with no binaries involved, and keeps process spawning in exactly one place.

- `GOALS.md` — the frozen scope contract
- `IMPLEMENTATION_PLAN.md` — stack, architecture, per-action techniques, milestones
- `docs/ARCHITECTURE.md` — what actually exists, updated per milestone
- `docs/adr/` — decision records for every deviation from the plan
- `docs/THIRD_PARTY.md` — every bundled binary, its version and licence
- `docs/RELEASING.md` — how to cut a release and publish it

## License

MIT — see `LICENSE`. Bundled binaries keep their own licences (`docs/THIRD_PARTY.md`);
FFmpeg is the LGPL build, and no GPL/AGPL component ships in this project.
