# ADR 004 — P3 ships with stages 1+3; stage 2 (selective re-render) deferred

Date: 2026-07-25 · Status: accepted

## Context

§6/P3 specifies three stages: (1) qpdf lossless, (2) pdfium-driven selective re-render of
pages containing oversized images, (3) full rasterize floor. Stage 2 requires image-object
analysis and per-page PDF surgery — the most complex piece of the riskiest milestone —
while stage 3 already guarantees the gate ("10 MB mixed PDF under 1 MB, readable").

## Decision

v1 implements stage 1 (qpdf `--object-streams=generate --recompress-flate
--compression-level=9`) and stage 3 (pdfium render → JPEG pages → minimal PDF writer at
120/96/72 dpi, q75/60/60). Stage 2 is deferred; the pipeline structure (staged attempts in
`src-tauri/src/pdf.rs`) keeps an obvious insertion point.

Trade-off: mid-size targets on text+image PDFs lose text selectability sooner than the
full design would allow. The output warns via the completion toast ("text is no longer
selectable") exactly as §6 prescribes for stage 3.

## Addendum (2026-07-25) — quality levels alongside the size target

Users who just want "smaller" and have no size in mind now get three levels, sharing the
same machinery:

- **High** — the lossless qpdf pass only. Text stays selectable. If qpdf cannot make the
  file any smaller, the action says so and points at Medium/Low rather than handing back
  an identical file (measured: a 115 KB uncompressed-stream PDF → 15 KB).
- **Medium** — rasterize at 150 dpi, JPEG q75 (measured: 4.0 MB → 871 KB).
- **Low** — rasterize at 96 dpi, JPEG q60 (measured: 4.0 MB → 267 KB).

Medium and Low destroy the text layer, so the menu labels say "pages become images"
outright. Both compare their result against the lossless pass and keep whichever is
smaller, since rasterizing a text-only PDF can inflate it.

## Consequences

- M4's gate is met with materially less risk; stage 2 can land post-v1.0 without schema
  or UX changes.
- Encrypted inputs are detected up front (`qpdf --is-encrypted`) → UserError pointing at
  the Unlock action, satisfying the gate's error-path requirement.
