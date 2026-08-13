# Zapit — Project Goals

> **Status: FROZEN (v1.1 contract).** This document is the single source of truth for scope.
> Nothing gets built that isn't listed here; nothing listed as Core ships broken.
> Changes require editing this file *first*, in its own commit, with a reason.

Last updated: 2026-08-13

> **v1.2 amendment (2026-08-13):** **V6/A2 Trim grows a real timeline window.** The original
> "mini window: start/end" shipped as two text boxes — you typed timestamps blind, and got
> exactly one cut per run. Every tool this action is meant to replace (online audio cutters,
> video trimmers) shows you the media while you cut it, so the window now has a preview
> player, a filmstrip + waveform timeline, drag-placed cut regions, **multiple cuts per file**,
> a Keep/Remove toggle, and a merge-or-export-separately choice. Still one action, still one
> window, still offline. See `docs/adr/005-multi-segment-trim-window.md`.

> **v1.1 amendment (2026-07-25):** The **Pro edition is parked indefinitely** and the project is
> now **open source (MIT)**. v1 ships the Free edition only. All Pro sections below are retained
> for the record but are **out of scope** — no Pro code, licensing, or AI runtime work happens
> unless this document is amended again first. See `docs/adr/001-free-only-open-source.md`.

## Vision

**Zapit** — right-click any file on Windows and instantly do the obvious thing with it.
No app to open, no upload, no browser tab hunting for "ilovepdf" or "compress image to 50kb online".
Select file(s) → context menu → done. Output lands next to the source.

It replaces the everyday online tools people use for small file operations:
iLovePDF (merge/split/compress/protect), online image compressors for government/exam
form uploads ("photo must be 20–50 KB"), audio trimmers, video compressors for
Discord/WhatsApp, HEIC converters for iPhone photos, checksum sites.

## Principles

1. **Fast** — menu click to visible progress in under a second; stream-copy instead of re-encode wherever possible.
2. **Fully offline & private** — no network calls, no telemetry, no accounts. Ever. (Both editions.)
3. **Never destructive** — the source file is never modified or overwritten; outputs get collision-safe names (`video.m4a`, `video (2).m4a`).
4. **Per-user** — installs and registers without admin rights; uninstall leaves zero registry residue.
5. **No dead ends** — every failure produces a human-readable toast + log line, never silence.
6. **Lean free tier** — the Free installer stays small (target ≤ 100 MB); heavy AI models live only in Pro.

## Editions

> **Parked (v1.1):** only Zapit Free is being built. The Pro column describes a possible
> future paid edition and is not part of the current scope.

| | **Zapit Free** | **Zapit Pro (parked)** |
|---|---|---|
| Contents | All standard actions (video/audio/image/PDF/general) | Everything in Free **+** AI actions **+** power-user features |
| Bundle | Small: app + FFmpeg (LGPL) + qpdf + pdfium (~≤100 MB installer) | Large: adds ONNX Runtime, Whisper, Real-ESRGAN + models (installer with selectable components, up to ~1.5 GB) |
| License check | None | Offline license key (Ed25519-signed, no server, perpetual) |
| Distribution | Free download | Sold via a payment provider that issues license keys (Gumroad / LemonSqueezy / Paddle) |

Both editions are built from the same codebase; actions are tagged `free` or `pro` and gated at runtime.
Two editions only — a middle tier was considered and rejected (more SKUs = more testing = slower ship).

## Action Catalog — Free Edition

Tiers: **Core** = ship blockers, non-negotiable. **Extended** = committed, cheap once the engine exists.
**Stretch** = end-of-project bonus picks; cut without guilt if they threaten the release.

### 🎬 Video
Input extensions: mp4, mkv, mov, avi, webm, wmv, flv, ts, m4v, mts, 3gp (+ gif for GIF→video)

| # | Action | Description | Tier |
|---|--------|-------------|------|
| V1 | Extract audio | Stream-copy to native container (m4a/mp3/ogg/flac/wav) when possible; MP3 re-encode fallback | **Core** |
| V2 | Remux to MP4 | Container swap, no re-encode, seconds. The "fix my OBS .mkv" button | **Core** |
| V3 | Compress video… | Target size (10/25/50 MB/custom — Discord/WhatsApp) or quality presets; two-pass encode | **Core** |
| V4 | Convert to… | MP4 / MKV / WebM / MOV submenu | **Core** |
| V5 | Video → GIF | Two-pass palettegen for good colors and sane size | **Core** |
| V6 | Trim… | Timeline window: preview player, drag cut regions, multiple cuts per file, merge or export each clip; precise re-encode by default, lossless keyframe-cut option | **Core** |
| V7 | Merge videos | Multi-select → concat; lossless when codecs match, re-encode otherwise | Extended |
| V8 | Mute video | Strip audio track, no re-encode | Extended |
| V9 | Extract frame / contact sheet | PNG frame at a timestamp; or a tiled thumbnail-overview image | Extended |
| V10 | Make editing-friendly | VFR→CFR + all-intra re-encode — screen recordings that scrub properly in editors | Extended |
| V11 | Downscale to… | 1080p / 720p / 480p | Extended |
| V12 | GIF → MP4/WebM | Reverse of V5 (big GIFs → small videos) | Extended |
| V13 | Change speed | 0.5× / 2× / custom, audio pitch-corrected | Stretch |
| V14 | Rotate | 90 / 180 / 270 | Stretch |
| V15 | Fit for Reels/Status | Pad to 9:16 or 1:1 | Stretch |

### 🎵 Audio
Input extensions: mp3, wav, flac, m4a, aac, ogg, opus, wma

| # | Action | Description | Tier |
|---|--------|-------------|------|
| A1 | Convert to… | MP3 / WAV / FLAC / M4A / OGG | **Core** |
| A2 | Trim… | Shares the timeline window with video, waveform instead of filmstrip ("online audio cutter" replacement) | **Core** |
| A3 | Normalize loudness | Two-pass EBU R128 loudnorm | Extended |
| A4 | Merge audio | Multi-select → one file | Extended |
| A5 | Boost volume | 1.5× / 2× | Extended |

### 🖼️ Image
Input extensions: png, jpg/jpeg, webp, bmp, tiff, gif, heic/heif, svg (input only)

| # | Action | Description | Tier |
|---|--------|-------------|------|
| I1 | Convert to… | PNG / JPG / WebP / ICO (multi-size icon) | **Core** |
| I2 | Resize to exact spec… | Percent, px (`100×120`), or cm + DPI (`3.5×4.5 cm @ 200 DPI`) — gov-form phrasing | **Core** |
| I3 | Compress to target size… | Enter "50 KB" → quality/dimension search until it fits. The gov-form hero feature | **Core** |
| I4 | HEIC → JPG/PNG | iPhone photo fixer (technical spike scheduled — see plan §11) | **Core** |
| I5 | Images → PDF | Multi-select, reorder window (shared with P1) | Extended |
| I6 | View & remove metadata | Show EXIF/GPS, one click to strip | Extended |
| I7 | SVG → PNG | Rasterize at chosen size (rendered in our own webview) | Extended |
| I8 | OCR → text | Image text → .txt / clipboard (tesseract, offline) | Stretch |
| I9 | Photo → scanned-doc PDF | "CamScanner effect": grayscale + contrast cleanup + PDF wrap | Stretch |
| I10 | Passport print sheet | Tile one photo ×N onto 4×6″/A4 at correct DPI | Stretch |

### 📄 PDF

| # | Action | Description | Tier |
|---|--------|-------------|------|
| P1 | Merge PDFs | Multi-select → reorder window → one PDF | **Core** |
| P2 | Split / extract pages… | Range grammar (`1-3,7,9-`) → new PDF(s) | **Core** |
| P3 | Compress to target size… | Lossless first (qpdf), then progressive image downsampling until under target. Highest-risk Core item — built early (see plan §11) | **Core** |
| P4 | PDF → images | One PNG per page | Extended |
| P5 | Extract text | → .txt | Extended |
| P6 | Protect / Unlock | Add password, or remove it (requires knowing the current password — not a cracker) | Extended |
| P7 | Rotate pages | 90 / 180 / 270 | Stretch |
| P8 | Add page numbers | Stamp page numbers | Stretch |
| P9 | Watermark… | Text or image stamp across pages | Stretch |
| P10 | Place signature… | Stamp a signature image on a chosen page/corner | Stretch |

### 🧾 General (any file)

| # | Action | Description | Tier |
|---|--------|-------------|------|
| G1 | Checksum | SHA-256/MD5 → copy to clipboard + compare against a pasted hash | Extended |

**Free tally: 15 Core · 16 Extended · 10 Stretch = 41 actions**

## Action Catalog — Pro Edition (PARKED — not in scope for v1)

> Retained for the record only. None of X1–X8 gets built, spiked, or scaffolded in v1.

All Pro AI features run **fully offline** with bundled models. No cloud inference.

| # | Action | Description | Engine | Tier |
|---|--------|-------------|--------|------|
| X1 | Remove background | Image → transparent PNG | ONNX segmentation (ISNet/U²-Net) | **Core-Pro** |
| X2 | Replace ID-photo background | Segment person, fill white/blue/red — pairs with the gov-form story | Same model as X1 | **Core-Pro** |
| X3 | Upscale image 2×/4× | Photo/art upscaling | Real-ESRGAN (ncnn-vulkan sidecar, GPU) | **Core-Pro** |
| X4 | Transcribe → TXT/SRT | Speech-to-text for audio & video, auto language | whisper.cpp sidecar | **Core-Pro** |
| X5 | Auto-subtitle video | X4 + soft-mux SRT into MKV/MP4 (burn-in optional) | whisper.cpp + FFmpeg | Extended-Pro |
| X6 | Custom action builder | Power users define their own FFmpeg preset as a new menu entry | app feature (no AI) | Extended-Pro |
| X7 | Separate vocals / instrumental | Music stem split | MDX-Net ONNX (high-risk spike; may be cut) | Stretch-Pro |
| X8 | Make PDF searchable | OCR text layer over scanned PDFs | tesseract + pdf rebuild | Stretch-Pro |

**Pro tally: 4 Core-Pro · 2 Extended-Pro · 2 Stretch-Pro**

## Non-Goals (locked out — scope cannot creep past this line)

- ❌ Any-to-any converter GUI / conversion routing graph (this is a quick-actions tool, not a converter clone)
- ❌ Win11 *top-level* modern context menu (MSIX + signed COM). "Show more options" is the contract for v1
- ❌ Cloud features, accounts, telemetry, auto-update
- ❌ Timeline/multi-track video editing, effects, subtitle *authoring*
- ❌ Office formats (DOCX→PDF, PDF→Word) — lightweight conversions produce garbage and damage trust
- ❌ YouTube/online downloaders — network + legal gray zone
- ❌ Archive tools (zip/7z) — Windows 11 ships this natively
- ❌ QR/text utilities (case converter, word count) — no natural file-context fit
- ❌ macOS / Linux

## Definition of Done ("I pack it" means)

Every shipped action passes all of:
1. 3 real sample files per action, including one adversarial one (odd dimensions, VFR, exotic codec)
2. Filenames with spaces + non-English characters (e.g. `मेरा वीडियो (final) 2.mp4`)
3. A > 2 GB video for the video actions
4. Cancel mid-job works and leaves no temp garbage
5. Output naming never overwrites anything
6. Install → use → uninstall leaves the registry exactly as it started
7. No console window ever flashes
8. ~~Pro only: actions correctly locked without a valid license key, unlocked with one~~ *(parked with the Pro edition)*

Plus, release-level:
- Free NSIS installer ≤ ~100 MB *(Pro installer: parked)*
- Third-party licenses screen lists every bundled component
- All quality gates in `IMPLEMENTATION_PLAN.md` §12 green
