# ADR 003 — HEIC decoding via ImageMagick sidecar (spike §11.1 result)

Date: 2026-07-25 · Status: accepted

## Context

Spike §11.1 (before I4). Candidates tested on a real HEIC:

1. **Pinned BtbN LGPL FFmpeg**: no HEIF demuxer in the build → fails.
2. **libvips web build** (LGPL-clean): HEIF container parses but "support for this
   compression format has not been built in" — the web flavor omits the HEVC decoder
   (libde265); the "all" flavor bundles x265 (GPL) and is off-limits.
3. **libheif official releases**: source tarballs only, no Windows binaries.
4. **Windows WIC + OS HEIF extensions**: zero bundle cost but the HEVC extension is not
   reliably installed → violates "no dead ends".
5. **ImageMagick portable Q16 x64** (`magick.exe`, ~31 MB, fully standalone — verified in
   isolation): decodes HEIC out of the box (bundles libheif + libde265). License:
   ImageMagick License (permissive, Apache-2-like); bundled decode libs are LGPL. ✔

## Decision

Bundle **`magick.exe`** (ImageMagick 7.1.2-27 portable Q16 x64) as a sidecar, pinned by
SHA-256 in `scripts/fetch-sidecars.ps1`. It is used for **image work where FFmpeg falls
short**: I4 HEIC→JPG/PNG, I2 exact-DPI resizes (FFmpeg cannot write DPI metadata), the
I3 compress-to-size quality search, and I1's multi-size ICO assembly
(`-define icon:auto-resize` — supersedes the `ico` crate from the §1 stack table; one
sidecar step beats a new crate + a new plan-step kind). FFmpeg remains the engine for
plain raster conversion.

`sample.heic` for tests is **fetched, not committed** (Nokia's public HEIF test image —
redistribution terms unclear, so it stays out of the MIT repo; smoke.ps1 downloads it).

## Consequences

- Installer grows by ~10 MB compressed. If the ≤100 MB Free-installer target gets tight at
  M7, switch FFmpeg to the BtbN *shared* LGPL build (ffmpeg/ffprobe share DLLs) — noted in
  the M7 checklist.
- A `magick` variant joins `SidecarBin` in the plan schema (TS + Rust).
- Deviation from §13 (sample.heic "checked in") documented above.
