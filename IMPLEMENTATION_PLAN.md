# Zapit — Implementation Plan

> **Audience: the Claude Code agent (and humans) implementing this project.**
> Read `GOALS.md` first — it is the frozen scope contract. This document says *how* to build it.
> Work milestone by milestone (§10). Do not skip ahead. Update the checkboxes in §10 as tasks complete.
> If reality forces a deviation from this plan, write an ADR in `docs/adr/` explaining why, *then* deviate.

Last updated: 2026-07-25 · Status: **M7 packaging done + §7.3 preset submenus implemented** — remaining for `v1.0`: the clean-machine DoD pass, then optional Stretch picks

> **§7.3 follow-up (2026-07-25):** preset submenus and the declarative `optionsUI` (§5.1)
> were missing from the first M6 build, so every action got a single flat menu entry and
> five of them silently applied a default the user never chose ("Compress video" always
> targeted 25 MB; "Convert to…" on audio was unusable). Now every action that reads an
> option declares `presets`, the `run` verb carries `--opt k=v`, the dispatcher buckets by
> action **+ options**, and `scripts/test-presets.ps1` runs all 558 registry entries.

> **Scope note (v1.1, ADR 001):** Free edition only; the project is open source (MIT).
> Milestones **M8–M10 are parked** — do not start them. M7's gate is the v1.0 release.

---

## 1. Technology Stack (decided — do not relitigate)

| Layer | Choice | Version pin | Why |
|---|---|---|---|
| App framework | **Tauri v2** | latest stable 2.x | Small bundle, fast cold start (critical for context-menu UX), Rust backend + web frontend |
| Backend language | Rust (MSVC toolchain) | stable | Tauri requirement; process spawning, registry, hashing |
| Frontend | TypeScript **strict** + Vite, **no UI framework** | TS ≥ 5.x | The UI is 4 small windows; a framework is dead weight. Same approach as p2r3/convert |
| Media engine | **FFmpeg + FFprobe, LGPL build** (BtbN `win64-lgpl` release) | pin exact release in `docs/THIRD_PARTY.md` | The workhorse. **Must be the LGPL build** — Pro is sold closed-source; GPL builds are forbidden |
| PDF manipulation | `pdf-lib` (JS, MIT) | ^1.x | Merge/split/rotate/stamp — pure JS, runs in webview |
| PDF encrypt/optimize | **qpdf** sidecar (Apache-2.0) | latest | Protect/unlock (P6), lossless compression pass (P3) |
| PDF rendering | **pdfium** via `pdfium-render` crate (BSD) | latest | PDF→images (P4), rasterize fallback for P3. Do NOT use pdf.js — pdfium is faster and license-clean |
| PDF text extract | `pdfium-render` text API | — | P5 |
| OCR | `tesseract.js` (Apache-2.0) in a webview worker | ^5 | I8; Pro X8 |
| Icon assembly | `ico` crate (MIT) | — | I1 ICO output (16/32/48/256 multi-size) |
| EXIF read | `kamadak-exif` crate (BSD) | — | I6 view; strip via FFmpeg `-map_metadata -1` |
| Hashing | `sha2`, `md-5` crates (MIT/Apache) | — | G1, streaming, no full-file loads |
| Registry | `winreg` crate (MIT) | — | Context-menu install/uninstall |
| AI runtime (Pro) | `ort` crate (ONNX Runtime, MIT) | 2.x | X1/X2 segmentation, X7 |
| Speech-to-text (Pro) | **whisper.cpp** sidecar (MIT) + GGML models | pin release | X4/X5. Sidecar exe, not linked |
| Upscaling (Pro) | **realesrgan-ncnn-vulkan** sidecar (BSD/MIT) | pin release | X3. GPU via Vulkan, CPU fallback exists |
| License keys (Pro) | `ed25519-dalek` (BSD) | 2.x | Offline signature verification |
| Installer | NSIS via `tauri-bundler` | — | Per-user install, component selection for Pro |
| Tauri plugins | `single-instance`, `shell`, `dialog`, `notification`, `clipboard-manager`, `cli` | v2 versions | See §5–6 |

**License rule (hard gate):** every runtime dependency must be MIT/BSD/Apache/LGPL. No GPL/AGPL anywhere
(sidecar exes included — use LGPL FFmpeg, never a GPL build; never Ghostscript). Record every bundled
binary + its license + source URL in `docs/THIRD_PARTY.md` as you add it. The Settings window shows this list.

**Borrowed from p2r3/convert (ideas only — its code is GPL-2.0, do not copy code):**
- The handler/action registry pattern (uniform interface, register in a list, UI generated from the list)
- FFmpeg stderr-driven auto-retry (parse error → add fix-up flag → retry once)
- Format metadata modeling (extension/mime/category per action)

---

## 2. Architecture Overview

```
┌──────────────────── Windows Explorer ────────────────────┐
│ right-click file(s) → registry verb:                     │
│   zapit.exe run <action-id> --file "%1"                  │
└──────────────────────────┬───────────────────────────────┘
                           ▼  (one process per selected file!)
┌──────────────── zapit.exe (Tauri v2) ────────────────────┐
│ Rust core                                                │
│  ├─ single-instance: followers forward argv to leader    │
│  ├─ dispatcher: buckets (action, files), 400 ms debounce │
│  ├─ SidecarRunner: spawn ffmpeg/qpdf/whisper…            │
│  │    CREATE_NO_WINDOW · progress parsing · kill on cancel│
│  ├─ fs services: probe, collision-safe naming, temp dirs │
│  ├─ registry service: install/uninstall context menu     │
│  └─ license service (Pro): Ed25519 verify, action gating │
│ Webview (TypeScript, mostly hidden)                      │
│  ├─ action registry: every action = one TS module        │
│  │    buildPlan(inputs, options) → EnginePlan (pure!)    │
│  ├─ JS engines: pdf-lib, tesseract.js, svg-render        │
│  └─ windows: Progress · Trim · Reorder · Settings · Meta │
└───────────────┬────────────────────────┬─────────────────┘
                ▼                        ▼
        sidecar processes         output files next to source
   (ffmpeg, ffprobe, qpdf,        + toast notification
    whisper, realesrgan)
```

**The one pattern that makes this testable — declarative plans:**
Action modules never spawn processes. They are pure functions:

```ts
buildPlan(inputs: FileInfo[], options: ActionOptions): EnginePlan
```

An `EnginePlan` is data: a list of steps (`ffmpeg` argv, `qpdf` argv, `js:pdf-merge` calls, probe
requests, retry rules). The Rust/JS runners execute plans. This means every action's logic is unit
testable with zero binaries involved, and the smoke harness can diff plans against golden files.

---

## 3. Repository Layout

```
zapit/
├─ GOALS.md · IMPLEMENTATION_PLAN.md · CLAUDE.md
├─ docs/
│  ├─ ARCHITECTURE.md        # living doc, updated each milestone
│  ├─ THIRD_PARTY.md         # every bundled binary: version, license, source URL
│  ├─ TEST_MATRIX.md         # manual shell-integration checklist (M7)
│  └─ adr/                   # 001-*.md decision records for plan deviations
├─ src/                      # TypeScript frontend
│  ├─ actions/               # ONE FILE PER ACTION: video/extractAudio.ts, pdf/merge.ts …
│  │  └─ registry.ts         # imports all actions, exports ordered list
│  ├─ core/                  # plan types, options schema, naming rules (pure, no tauri imports)
│  ├─ engines/               # js-side executors: pdfLib.ts, tesseract.ts, svgRender.ts
│  ├─ ipc/                   # typed wrappers around tauri invoke/events
│  └─ windows/               # progress/, trim/, reorder/, settings/, metadata/
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs · dispatch.rs · sidecar.rs · probe.rs
│  │  ├─ naming.rs · registry_menu.rs · hash.rs · license.rs
│  │  └─ ai/                 # Pro: ort sessions, matte compositing
│  ├─ sidecars/              # ffmpeg.exe, ffprobe.exe, qpdf.exe (+Pro: whisper, realesrgan)
│  ├─ capabilities/ · tauri.conf.json · Cargo.toml
├─ test/
│  ├─ unit/                  # vitest: plan builders, parsers, naming
│  ├─ golden/                # expected EnginePlans as JSON
│  └─ assets/                # small sample files (see §13)
├─ scripts/
│  ├─ fetch-sidecars.ps1     # downloads pinned sidecar releases + verifies SHA-256
│  ├─ smoke.ps1              # runs real conversions over test/assets, checks outputs
│  └─ make-license-key.ts    # Pro keygen — NEVER ship; private key stays out of repo
└─ package.json · vite.config.ts · tsconfig.json · eslint.config.js
```

---

## 4. Invocation Protocol & Multi-Select Aggregation

CLI grammar (parsed in Rust, `tauri-plugin-cli`):

```
zapit.exe run <action-id> --file <abs-path>     # from context menu (one file per process)
zapit.exe settings                              # settings window
zapit.exe install-menu | uninstall-menu         # shell integration
zapit.exe smoke <action-id> --file … --file … --opt k=v --out <dir>   # headless, for scripts/smoke.ps1
```

**Aggregation algorithm (Explorer launches N processes for N selected files):**
1. `tauri-plugin-single-instance`: followers forward their full argv to the leader and exit immediately.
2. Leader keeps `pending: Map<actionId, {files: Vec<PathBuf>, deadline: Instant}>`.
3. Each arriving `run` resets that action's deadline to `now + 400 ms`.
4. On deadline: sort files naturally (Explorer order is not preserved — document this), dedupe, dispatch one job.
5. Single-file actions (V6 trim…) dispatch per file immediately; multi-file actions (P1, V7, A4, I5) always wait out the window.
6. Also write `MultipleInvokePromptMinimum` guidance + `MultiSelectModel=Player` on our verbs so Windows doesn't cap/prompt at 15 files.

---

## 5. Core Subsystem Specs

### 5.1 Action registry (TS)
```ts
interface QuickAction {
  id: string;                       // "extract-audio" — stable, used in registry verbs
  menuLabel: string;                // "Extract audio"
  category: "video"|"audio"|"image"|"pdf"|"general";
  extensions: string[];             // lowercase, no dot
  multiFile: "single"|"multi"|"both";
  edition: "free"|"pro";
  tier: "core"|"extended"|"stretch";
  optionsUI?: OptionsSpec;          // declarative: submenu presets, or a window (trim/reorder/prompt)
  buildPlan(inputs: FileInfo[], opts: ActionOptions): EnginePlan;  // PURE — no IO
}
```
`registry.ts` exports the ordered list; menu generation, settings toggles, and dispatch all derive from it.
Adding an action = one file + one import line (convert's proven pattern).

### 5.2 SidecarRunner (Rust)
- Spawn with `CREATE_NO_WINDOW` (0x08000000). Absolute sidecar paths from the resource dir. Never through a shell — argv arrays only (kills injection + quoting bugs).
- FFmpeg progress: append `-progress pipe:1 -nostats -hide_banner`; parse `out_time_us=` lines against ffprobe duration → percent → emit `job://progress` events.
- Capture last 50 stderr lines in a ring buffer for error reporting.
- Cancel: kill the child process, delete the job's temp dir. All intermediate files live in `%TEMP%\zapit\<job-uuid>\`; finished outputs are *moved* into place (atomic-ish, never a half-written file next to the user's data).
- Retry rules from the plan (convert's trick): e.g. stderr contains `not divisible by 2` → retry once with `-vf pad=ceil(iw/2)*2:ceil(ih/2)*2`.

### 5.3 Probe service (Rust)
`ffprobe -v quiet -print_format json -show_format -show_streams` → typed `MediaInfo` (duration, streams, codecs, dimensions, VFR detection via `avg_frame_rate != r_frame_rate`). Plans branch on this.

### 5.4 Output naming (Rust, pure fn + unit tests)
`resolve_output(source_dir, base, new_ext) → PathBuf`: `video.m4a` → `video (2).m4a` → `(3)`…
Honors the configured output policy (same folder / ask / fixed folder). If the target dir is read-only → fall back to "ask" with a clear message.

### 5.5 Context-menu registry layout (per-user, no admin)
For each relevant extension and enabled action:
```
HKCU\Software\Classes\SystemFileAssociations\.mp4\shell\Zapit
    MUIVerb   = "Zapit"
    Icon      = "<install>\zapit.exe"
    SubCommands = ""                      # makes it a cascading flyout
HKCU\...\Zapit\shell\010_extract-audio
    MUIVerb   = "Extract audio"
    MultiSelectModel = "Player"
    \command  @= "\"<install>\zapit.exe\" run extract-audio --file \"%1\""
```
- Numeric prefixes (`010_`) control ordering; ids after the prefix must match `QuickAction.id`.
- G1 (checksum) registers under `HKCU\Software\Classes\*\shell\Zapit`.
- `install-menu` writes keys for *enabled* actions only; Settings toggles rewrite them; `uninstall-menu` deletes every key we own and nothing else. Idempotent both ways.
- Win11: appears under "Show more options" — per GOALS.md non-goals, that is the contract.

### 5.6 Windows (UI) inventory — keep them tiny
| Window | Used by | Contents |
|---|---|---|
| Progress | every job > ~1 s | filename, action, progress bar, cancel. Auto-close on success → toast |
| Trim | V6, A2 | start/end fields + slider, duration from probe, "lossless (nearest keyframe)" checkbox |
| Reorder | P1, I5, V7, A4 | file list, up/down/drag, remove, Go |
| Prompt | I2, I3, P2, P3… | one labeled input (target KB, page range, dimensions) with validation + presets |
| Settings | — | action toggles per category, output policy, install/remove menu, license key entry (Pro), third-party licenses, log folder link |
| Metadata | I6 | EXIF table + "Remove all" button |

Toast on completion (`tauri-plugin-notification`); click → open output folder with file selected.

### 5.7 Config, logging, errors
- Config: `%APPDATA%\Zapit\config.json` — schema-versioned (`"v": 1`), serde-validated, corrupt file → rename `.bad` + defaults (never crash).
- Logs: `%APPDATA%\Zapit\logs\zapit.log`, rotate at 1 MB × 5.
- Error taxonomy: `UserError` (bad input/cancel → friendly toast, no log spam) · `EngineError` (sidecar non-zero → toast "couldn't convert X" + stderr tail to log) · `SystemError` (fs/permissions → actionable message). Every toast has a "details" path to the log.

### 5.8 Edition gating & license keys (Pro)
- Key = base64(payload JSON: name, email, edition, issued-at) + Ed25519 signature. Public key embedded in the binary; `scripts/make-license-key.ts` holds the private key **outside the repo** (env var), never bundled.
- Verification is offline, at startup + key entry. Invalid/absent key → Pro actions hidden from menu generation and refused at dispatch (defense in depth).
- No activation server, no expiry (perpetual). Accepted trade-off: determined pirates win; honest users have zero friction. Payment provider (Gumroad/LemonSqueezy/Paddle) generates keys via the same Ed25519 scheme (their webhook/CLI runs the keygen).

### 5.9 AI engines (Pro)
- **Segmentation (X1/X2):** `ort` + ISNet/U²-Net ONNX (~170 MB). Pipeline: load → letterbox to 320×320 (u2net) or 1024 (isnet) → normalize → infer matte → bilinear upscale matte → X1: alpha-composite to transparent PNG · X2: composite over solid color (white/blue/red presets).
- **Upscale (X3):** spawn `realesrgan-ncnn-vulkan -i in -o out -s 4 -n realesrgan-x4plus` (`-x4plus-anime` variant option). Vulkan GPU; document CPU fallback slowness.
- **Transcribe (X4/X5):** extract audio to 16 kHz mono WAV via FFmpeg → `whisper-cli -m ggml-<size>.bin -osrt -otxt`. Model choice (base/small/medium) = installer components. X5: `ffmpeg -i video -i out.srt -c copy -c:s mov_text` (soft-mux), burn-in optional via `subtitles=` filter.
- **X7 (stem split):** MDX-Net ONNX via `ort` — requires STFT pre/post in Rust. **High risk, spike first (§11), cut if the spike fails.** Do not let this block packaging.

---

## 6. Per-Action Technique Specs

Conventions: `IN`/`OUT` are absolute paths; every FFmpeg call includes `-hide_banner -y` (into temp, §5.2);
probe first when the plan branches. These are the *reference* techniques — plans encode them.

### Video
- **V1 extract-audio:** probe audio codec → map to container: aac/alac→`.m4a`, mp3→`.mp3`, opus→`.opus`, vorbis→`.ogg`, flac→`.flac`, pcm→`.wav` with `-vn -acodec copy`. Unknown/none → `-vn -c:a libmp3lame -q:a 2` → `.mp3`. No audio stream → UserError "This video has no audio."
- **V2 remux-mp4:** `-i IN -c copy -movflags +faststart OUT.mp4`. Probe guard: if video codec ∉ {h264, hevc, av1, mpeg4} or audio ∉ {aac, mp3, ac3, opus…} → UserError suggesting V4. hevc gets `-tag:v hvc1`.
- **V3 compress:** target-size math: `video_kbps = (targetMB·8192 / duration_s)·0.97 − audio_kbps` (audio 128k, or 96k if budget tight; below floor of ~150 video kbps → auto-downscale 1080→720→480 and warn). Two-pass x264: pass1 `-c:v libx264 -b:v Xk -preset medium -pass 1 -an -f null NUL`, pass2 with audio. Quality presets = single-pass CRF 20/26/32.
- **V4 convert:** container+codec matrix: mp4→x264+aac · mkv→copy-if-possible-else-x264 · webm→libvpx-vp9 `-crf 32 -b:v 0`+libopus · mov→x264+aac. Copy streams when already compatible (mkv→mp4 with h264 = remux, seconds).
- **V5 gif:** two-pass: `[pass1] -vf fps=15,scale=min(480\,iw):-2:flags=lanczos,palettegen=stats_mode=diff palette.png` `[pass2] … paletteuse=dither=bayer:bayer_scale=4`. Options window: fps 10/15/24, width 320/480/640.
- **V6 trim:** default precise: `-ss S -to E -i-order-matters` re-encode x264 CRF 18 + aac 192k. "Lossless" checkbox: `-ss S -to E -c copy` + info note "cuts at nearest keyframe". Validate 0 ≤ S < E ≤ duration.
- **V7 merge:** probe all; identical codec/resolution/fps → concat demuxer `-f concat -safe 0 -i list.txt -c copy`. Else normalize each to x264/aac at max common resolution, then concat. List file entries escaped (`'` → `'\''`).
- **V8 mute:** `-c copy -an`.
- **V9 frame/sheet:** frame: `-ss T -frames:v 1 -q:v 2 OUT.png`. Contact sheet: N=16 timestamps at `duration·(i+0.5)/16` via `select`, `-vf scale=320:-2,tile=4x4`.
- **V10 editing-friendly:** `-vf fps=60 -c:v libx264 -preset fast -crf 16 -g 1 -bf 0 -c:a pcm_s16le OUT.mov` (all-intra + PCM in MOV = every editor scrubs it).
- **V11 downscale:** `-vf scale=-2:H -c:v libx264 -crf 20 -preset medium -c:a copy`.
- **V12 gif→video:** `-i IN.gif -movflags +faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" OUT.mp4`.
- **V13 speed:** video `setpts=PTS/k`; audio `atempo` chained into (0.5–2.0] factors. **V14 rotate:** `transpose=1` (90cw), `transpose=1,transpose=1` (180) — re-encode; metadata-only rotation optional later. **V15 social:** `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`.

### Audio
- **A1 convert:** mp3→libmp3lame `-q:a 2` · wav→pcm_s16le · flac→flac · m4a→aac `-b:a 256k` · ogg→libvorbis `-q:a 6`. Same-codec (mp3→mp3) = UserError "already MP3".
- **A2 trim:** shares Trim window; precise `-ss/-to` re-encode in source codec, or copy for mp3/flac (frame-accurate enough).
- **A3 normalize:** two-pass loudnorm: pass1 `-af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null NUL`, parse JSON from stderr, pass2 with `measured_*` values.
- **A4 merge:** concat demuxer if same codec/params, else decode-concat via `concat` filter → encode to first file's format.
- **A5 boost:** `-af volume=1.5` / `2.0`.

### Image (engine: FFmpeg for raster ops; Rust crates for ico/exif; webview for svg)
- **I1 convert:** png/jpg/webp via ffmpeg (`-q:v 2` jpg, `-quality 90` webp; jpg gets `-vf format=rgb24` to kill alpha surprises). ICO: ffmpeg-scale to 256/48/32/16 PNGs → assemble with `ico` crate.
- **I2 resize:** Prompt accepts `50%` · `800x600` · `800w` · `3.5x4.5cm@200dpi` (cm→px: `round(cm/2.54·dpi)`; also set output DPI metadata). `-vf scale=W:H:flags=lanczos`; aspect-mismatch → fit + warn (no silent distortion).
- **I3 compress-to-KB:** if PNG w/o transparency → work as JPEG. Binary search JPEG `-q:v` 2..31 (≤7 iterations, temp files, pick largest ≤ target). Still too big at q=31 → scale 0.85× per outer iteration (max 6). Emit final "48.7 KB, 92×110" toast. PNG w/ transparency → same loop with WebP `-quality`.
- **I4 heic→jpg:** SPIKE §11.1 decides decoder (ffmpeg heif demuxer vs libheif). Post-spike this is a one-liner convert.
- **I5 images→pdf:** Reorder window → pdf-lib: embed JPG as-is; PNG re-encoded to JPEG q85 unless transparency; page = image dims @ 72 dpi capped to A4 width.
- **I6 metadata:** read `kamadak-exif` → table window; strip: `ffmpeg -i IN -map_metadata -1 -c copy OUT` (jpg: `-c copy` keeps pixels untouched).
- **I7 svg→png:** hidden webview: `<img src=blobURL>` → canvas at requested size → PNG bytes back over IPC.
- **I8 ocr:** tesseract.js worker, `eng` bundled (more langs = Settings download… no, offline rule: bundle `eng`+`hin`, note in THIRD_PARTY sizes). Output `.txt` + clipboard option.
- **I9 scan-pdf:** `-vf format=gray,eq=contrast=1.5:brightness=0.03` → JPEG q80 → I5 pipeline. No deskew (out of scope).
- **I10 passport-sheet:** Prompt: photo size preset (35×45 mm…) + sheet (4×6″/A4) + DPI 300 → compute grid, ffmpeg `tile` with padding, white background.

### PDF
- **P1 merge:** Reorder window → pdf-lib `copyPages` in order → save. Encrypted input → UserError naming the file ("unlock it first — right-click → Unlock PDF").
- **P2 split:** range grammar `1-3,7,9-` (1-indexed, open end; unit-tested parser in `core/`). One output per comma-group: `report (pages 1-3).pdf`.
- **P3 compress-to-target:** staged pipeline, stop as soon as ≤ target: (1) qpdf `--object-streams=generate --recompress-flate --compression-level=9`; (2) pdfium: find embedded images > 100 dpi-equivalent, re-render pages containing them at 150 dpi JPEG q80 via rebuild; (3) full rasterize at 120→96→72 dpi q75→60 until fit — warn "text is no longer selectable at this size". Never exceed 3 rasterize iterations. **Build in M4, it is the risk item.**
- **P4 pdf→images:** pdfium render each page at 150 dpi (Prompt: 72/150/300) → `doc (page 1).png` … zero-padded when >9 pages.
- **P5 extract-text:** pdfium text API → `.txt`; empty result → hint "This PDF looks scanned — Pro OCR can read it" (honest upsell, one line, never nags).
- **P6 protect/unlock:** protect: qpdf `--encrypt USER OWNER 256 --` (Prompt with confirm field). Unlock: qpdf `--password=X --decrypt` (Prompt, password masked). Wrong password → UserError, no retry loop.
- **P7 rotate:** pdf-lib `setRotation` all pages (or range via P2's parser). **P8 page-numbers:** pdf-lib draw text bottom-center, offer `N` / `N of M`. **P9 watermark:** pdf-lib diagonal text 45°, 0.15 alpha, or image stamp centered. **P10 signature:** Prompt: pick image + page + corner preset (no drag-placement UI — corners are enough for v1).

### General
- **G1 checksum:** Rust streaming SHA-256 (+MD5 toggle), 1 MB chunks with progress for big files → result window: hash, Copy, paste-to-compare field (constant-time compare, green/red).

---

## 7. UX Rules (uniform across all actions)

1. Instant actions (< ~1 s: remux, mute, copy-trim, checksum of small files) → no progress window, just the toast.
2. Everything else → Progress window (§5.6). ETA from FFmpeg progress; indeterminate bar for qpdf/AI.
3. Options flow: preset submenu entries where possible (Compress → "25 MB (Discord)") — clicks beat dialogs; Prompt/Trim/Reorder windows only where input is unavoidable.
4. Toast phrasing: success `"video.m4a created (12.3 MB)"` · failure `"Couldn't extract audio from video.mp4 — <short reason>"`.
5. Multi-file single-action (e.g. 5 images → Convert): one job, one progress window (`3/5…`), one summary toast.
6. Every string in one `src/core/strings.ts` module (future i18n, and it keeps copy consistent).

---

## 8. Free/Pro Build Strategy

- One codebase, one binary. Pro actions compiled in but gated (§5.8): simpler than two builds, and the AI *models* (the actual value, GBs of them) aren't in the Free installer anyway.
- Two NSIS artifacts: `Zapit-Setup.exe` (no models, ≤ ~100 MB) and `Zapit-Pro-Setup.exe` (adds sidecars + models as selectable components: segmentation ~170 MB, upscaler ~80 MB, whisper base/small/medium 148 MB/488 MB/1.5 GB).
- Pro actions with missing model components → menu entry hidden (not erroring).
- `scripts/fetch-sidecars.ps1` downloads pinned releases and verifies SHA-256 — binaries are never committed to git.

---

## 9. Business Checklist (not code — for the human)

- [ ] Code-signing certificate — unsigned installers get SmartScreen-blocked, fatal for a paid product. Cheapest sane route: Azure Trusted Signing (~$10/month) or an OV cert (~$100–250/yr).
- [ ] Payment provider that issues license keys (Gumroad / LemonSqueezy / Paddle — all handle VAT).
- [ ] Product name check: "Zapit" is generic (PowerToys ecosystem collision risk) — trademark-search before packing; renaming is a constant in one file.
- [ ] One-page EULA + privacy statement ("this software makes no network connections").
- [ ] FFmpeg LGPL compliance: THIRD_PARTY.md lists the exact build + source link (done via §1 rule).

---

## 10. Milestones — the step-by-step build order

> Agent: complete in order. A milestone is done only when its **Gate** passes. Tick boxes as you go.
> After each milestone: update `docs/ARCHITECTURE.md`, run the full §12 quality gate, commit.

### M0 — Environment & skeleton
- [x] Verify/install: Rust MSVC toolchain, Node LTS, NSIS prerequisites; document versions in ARCHITECTURE.md
- [x] Scaffold Tauri v2 app (`zapit`), vanilla-TS Vite frontend; wire plugins: single-instance, cli, shell, dialog, notification, clipboard-manager
- [x] Repo layout of §3; tsconfig strict, ESLint (typescript-eslint strict) + Prettier, clippy `-D warnings` + rustfmt in a `scripts/check.ps1`
- [x] `scripts/fetch-sidecars.ps1` for ffmpeg/ffprobe/qpdf (pinned, SHA-256-verified); THIRD_PARTY.md started
- [x] Hidden-main-window setup: app starts headless, no window flash
- **Gate: PASSED 2026-07-25** — `check.ps1` green · `tauri build` produced `zapit.exe` (5.1 MB) + NSIS installer; `smoke --help` and `--help` exit 0 with no window/console flash

### M1 — Core plumbing (no real actions yet)
- [x] CLI grammar + dispatcher with 400 ms aggregation (§4); unit tests for bucketing logic
- [x] `EnginePlan` types + plan runner: SidecarRunner (progress, cancel, retry rules, temp-dir lifecycle §5.2), JS-engine bridge
- [x] Probe service → `MediaInfo`; naming service + unit tests; config + logging + error taxonomy (§5.7)
- [x] Progress window + toasts wired to job events
- [x] A `noop` test action (copies a file via plan) proving the whole pipe: CLI → dispatch → plan → runner → output → toast
- **Gate: PASSED 2026-07-25** — `smoke noop` with two files (unicode + spaces) → one job, both outputs, collision-safe `(2)` on rerun, temp dir cleaned; two real `run` processes aggregated via single-instance into one job and the leader exited after idle. Unit tests: 21 Rust + 3 TS green. *Cancel wiring is in place (kill + temp cleanup); end-to-end cancel needs a long-running job — verified at the M2 gate with a real FFmpeg encode.*

### M2 — Video & audio Core (V1–V6, A1–A2)
- [x] V1, V2 (with probe guards) → first real value
- [x] V3 target-size (+ math unit tests; single-pass bitrate per **ADR 002** — LGPL build has no libx264/two-pass), V4 matrix, V5 palettegen (+ options plumbing)
- [x] Trim window; V6 + A2; A1
- [x] Golden-plan tests for all eight; smoke.ps1 runs them on test assets
- **Gate: PASSED 2026-07-25** — smoke all green: 2.2 GB file (V1 stream-copy), VFR remux (V2), unicode filename, no-audio UserError path; cancel mid-encode kills ffmpeg and leaves no temp garbage (heavy suite); golden tests 8/8; full check.ps1 green

### M3 — Image Core (I1–I4)
- [x] **Spike I4/HEIC first (§11.1)** — decided: ImageMagick sidecar (**ADR 003**; LGPL ffmpeg has no HEIF demuxer, vips web build has no HEVC decoder)
- [x] I1 (ICO via magick `icon:auto-resize`, supersedes ico crate — ADR 003), I2 (spec parser + unit tests), I3 (binary search + unit tests with a mocked encoder; 4000px pre-cap + extended downscale ladder for 48 MP sources)
- **Gate: PASSED 2026-07-25** — I3 ≤ 50 KB on 5 diverse photos incl. a 48 MP one (heavy suite); real HEIC converts via magick; prompt windows (resize/size) wired; check.ps1 green

### M4 — PDF Core (P1–P3) ← risk milestone
- [x] pdf-lib engine bridge (js:// steps + read/write byte commands); Reorder window; P1
- [x] Range parser + P2
- [x] pdfium-render + qpdf wiring; P3 staged pipeline (**ADR 004**: stages 1+3, stage 2 deferred); tested against a 29 MB image-heavy mixed PDF and a text-heavy PDF
- **Gate: PASSED 2026-07-25** — 29 MB mixed PDF → 711 KB (`qpdf --check` valid, target 1 MB); encrypted-input UserError for both P1 (pdf-lib load) and P3 (`qpdf --is-encrypted`); full suite green

### M5 — Extended actions (all 16 → 17 modules)
- [x] Video: V7–V12 · Audio: A3–A5 · Image: I5–I7 · PDF: P4–P6 (ships as two actions: protect + unlock) · G1
- [x] Metadata window (I6), password Prompts (P6), Result window (G1 hash + constant-time compare)
- **Gate: PASSED 2026-07-25** — smoke suite 40/40 + heavy 9/9 green; 67 TS + 30 Rust unit/golden tests; `docs/TEST_MATRIX.md` records automated coverage per action (manual shell/DoD rows land at M6/M7). New Rust steps: `checksum`, `loudnorm`, `pdf-render`, `pdf-text`, `write-text`.

### M6 — Shell integration & Settings
- [x] registry_menu.rs: install/uninstall from the action registry (§5.5), idempotent, enabled-actions-only; parent keys we create are recorded in config so uninstall never removes a pre-existing key
- [x] Settings window (toggles → registry rewrite, output policy, licenses screen from THIRD_PARTY.md, log folder link)
- [x] Explorer end-to-end: registered verb invoked exactly as Explorer does (single + 3-file aggregation), `MultiSelectModel=Player` written for every multi-file action
- **Gate: PASSED 2026-07-25** — `scripts/test-menu.ps1`: 15 checks green including an **empty registry diff** across install → re-install → uninstall → re-uninstall (volatile `Local Settings\…\PCT` timestamps excluded, documented in the script). Verb invocation produced outputs next to the source; 3 processes aggregated into one job; no lingering processes. Manual >15-file Explorer check remains for M7.

### M7 — Free edition packaging ← release milestone (ADR 001)
- [x] NSIS per-user installer via tauri-bundler; icon set; sidecars bundled as resources; installer hooks run `install-menu` on finish and `uninstall-menu` before uninstall
- [ ] Full DoD pass (GOALS.md) on a **clean Windows 11 VM/second machine** — not the dev box ← **remaining**
- [ ] Stretch-tier picks (V13–V15, I8–I10, P7–P10): implement only what fits, or ADR the cuts
- **Gate: PARTIAL 2026-07-25** — `scripts/test-install.ps1` 16/16 green on the dev machine: 83.9 MB installer (≤ 100 MB target), per-user install without admin, bundled sidecars used by the installed copy, menu auto-registered, unicode + KB-target actions work, `(2)` collision naming, no temp residue, and after uninstall the registry is byte-identical to before. **Tagged `v1.0-rc1`** — `v1.0` waits on the clean-machine pass (see `docs/TEST_MATRIX.md`).

### M8 — Pro: licensing & gating (PARKED — ADR 001)
- [ ] license.rs (Ed25519 verify), key entry in Settings, menu-generation + dispatch gating
- [ ] `scripts/make-license-key.ts` (private key via env var only); README note on payment-provider integration
- **Gate:** no key → Pro invisible & refused; valid key → visible; tampered key → rejected; all unit-tested

### M9 — Pro: AI actions (PARKED — ADR 001)
- [ ] Spike §11.3 (ort + segmentation) → X1, X2
- [ ] X3 (realesrgan sidecar), X4 (whisper sidecar + wav extraction), X5 (soft-mux)
- [ ] X6 custom-action builder (Settings form → user action in config → registry + dispatch honor it; ffmpeg argv template with `{in}`/`{out}` placeholders only — no shell)
- [ ] X7/X8 only if spikes pass and schedule allows; otherwise ADR the cut
- **Gate:** X1–X5 pass DoD incl. no-GPU fallback behavior (clear message, CPU path where available)

### M10 — Pro packaging & release (PARKED — ADR 001)
- [ ] Pro NSIS with model components (§8); missing-component behavior verified
- [ ] Full DoD both editions on clean machine; sign both installers (§9)
- [ ] Final docs pass: ARCHITECTURE.md, THIRD_PARTY.md complete; README with screenshots
- **Gate:** GOALS.md "Definition of Done" — every line. Tag `v1.0`.

---

## 11. Required Spikes (timeboxed experiments before committing)

1. **HEIC decode (before I4, in M3):** Test the pinned BtbN LGPL ffmpeg: `ffmpeg -i sample.heic out.jpg`. If unsupported → evaluate `libheif` prebuilt (LGPL) as sidecar/`libheif-rs`. Timebox: half a day. ADR the result.
2. **PDF compress quality (early M4):** Run the §6/P3 pipeline manually on 5 real-world PDFs (scanned, text, mixed, forms, huge). Decide stage-2 heuristics from data. Timebox: 1 day.
3. **ort + segmentation model (start of M9):** ISNet vs U²-Net quality on 10 photos; verify `ort` CPU inference < 10 s. Timebox: 1 day.
4. **MDX-Net stem split (X7):** only after X1–X5 done. STFT in Rust + model I/O working end-to-end in 2 days or cut it.

---

## 12. Quality Standards (enforced every milestone — this is the bar)

**TypeScript:** `strict: true` + `noUncheckedIndexedAccess`; zero `any` (use `unknown` + narrowing); ESLint typescript-strict + Prettier clean. Action modules are pure (§5.1) — anything touching Tauri IPC lives in `src/ipc/`. Every exported function has a doc comment saying *why*, not *what*.

**Rust:** `cargo clippy -- -D warnings` + rustfmt clean. No `unwrap`/`expect` outside tests and compile-time-known constants — errors flow through `thiserror` types into the §5.7 taxonomy. No `unsafe` without an ADR. Spawn with argv arrays, never shell strings.

**Tests (required, not aspirational):**
- Unit (vitest): every plan builder against golden JSON; parsers (page ranges, resize specs, CLI); naming; size-search logic; aggregation bucketing (Rust `#[test]`)
- `scripts/smoke.ps1`: headless real conversions over `test/assets`, asserts outputs exist / are under size targets / probe cleanly
- `docs/TEST_MATRIX.md`: manual shell checklist, re-run fully at M7 and M10

**Docs the agent maintains:** `docs/ARCHITECTURE.md` current at every milestone gate · `docs/adr/` for every deviation/cut · `docs/THIRD_PARTY.md` for every binary · module-level doc comments.

**Git:** conventional commits (`feat(video): add remux action`) · one logical change per commit · never commit binaries (sidecars are fetched) or the license private key · `scripts/check.ps1` (fmt + lint + clippy + tests) must be green before every commit.

## 13. Test Assets (`test/assets/`, **generated, not committed**)

`tiny.mp4` (h264+aac 5 s) · `tiny-vfr.mp4` / `tiny-vfr.mkv` (VFR) · `tiny-noaudio.mp4` · `tiny-720p.mp4` · `tone.mp3` / `tone.flac` · `photo.jpg` (large-ish) · `alpha.png` · `sample.heic` · `vector.svg` · `text.pdf` · `scanned.pdf` · `mixed.pdf` · `मेरा वीडियो (final) 2.mp4` (unicode-name copy of tiny.mp4).

**Deviation from the original plan (§13 said "checked in"):** every fixture except
`vector.svg` is deterministic output of the pinned sidecars, so `scripts/make-test-assets.ps1`
generates them on demand instead of carrying ~10 MB of binaries in git. `sample.heic` is
downloaded rather than committed because its redistribution terms are unclear (ADR 003).
Big-file (>2 GB), 48 MP and big-PDF cases are generated by `smoke.ps1 -Heavy`, as before.

## 14. Top Risks

| Risk | Mitigation |
|---|---|
| P3 PDF compression quality/complexity | Risk milestone M4 + spike §11.2; staged pipeline has a guaranteed-works rasterize floor |
| HEIC decoding support | Spike §11.1 with two fallback options |
| Antivirus/SmartScreen false positives (registry writes + unsigned) | Sign installers (§9); HKCU-only writes; no self-modification |
| ffmpeg edge cases (VFR, weird codecs) | Probe-guarded plans + retry rules + honest UserErrors suggesting the working action |
| Scope creep past GOALS.md | Non-goals list + ADR requirement for any change |
| X7 stem separation too hard | Explicitly cuttable; never blocks release |
