# ADR 002 — libopenh264 replaces libx264 (LGPL build has no GPL encoders)

Date: 2026-07-25 · Status: accepted

## Context

IMPLEMENTATION_PLAN.md §6 specifies `libx264` (and CRF/two-pass workflows) for every H.264
encode. x264 is GPL; the license rule mandates the BtbN **LGPL** FFmpeg build, which ships
without it. Discovered at M2 when generating test assets: `Unknown encoder 'libx264'`.

Available H.264 encoders in the pinned LGPL build: `libopenh264` (Cisco OpenH264, BSD,
software, always available), `h264_mf` (Windows MediaFoundation), and hardware encoders
(nvenc/amf/qsv — machine-dependent). Audio is unaffected (aac, libmp3lame, libopus,
libvorbis, flac, pcm all present).

## Decision

1. **`libopenh264` is the H.264 encoder** — the only always-available, license-clean choice.
   Hardware encoders may become an opt-in later (separate ADR).
2. OpenH264 has **no CRF and no two-pass**. Therefore:
   - **V3 target size**: single-pass bitrate encoding using the §6 budget math
     (97% budget, audio lane, downscale heuristics). OpenH264's bitrate rate-control plus
     `-maxrate`/`-bufsize` caps is accurate enough for "fits under the Discord limit".
   - **Quality-driven encodes** (V3 presets, V6 precise trim, V4 re-encode fallback) compute
     a bitrate from **bits-per-pixel heuristics** (`qualityKbps` in `src/core/videoMath.ts`)
     using probe dimensions: high ≈ 0.12 bpp, medium ≈ 0.07, low ≈ 0.04; trim uses 0.15
     (visually lossless-ish), convert re-encode 0.09.
3. All openh264 encodes pin `-pix_fmt yuv420p` (player compatibility).

## Consequences

- Slightly worse quality-per-bit than x264 — accepted; the alternative is violating the
  license rule or shipping no video compression at all.
- The §6 references to libx264/CRF/two-pass are superseded by this ADR where they conflict.
- If a future edition can legally ship GPL builds (it cannot while MIT + closed derivatives
  matter), this decision could be revisited.
