# Third-Party Components

Every bundled binary and runtime dependency, with exact version, license, and source.
Updated in the same commit as any pin bump in `scripts/fetch-sidecars.ps1`.
License rule (CLAUDE.md): MIT/BSD/Apache/LGPL only — no GPL/AGPL anywhere.

## Bundled sidecar binaries (fetched, never committed)

| Component                                                 | Version / pin                                                               | License                                                             | Source                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| FFmpeg + FFprobe                                          | `n8.1.2-31-g8c9502e9b0` (BtbN autobuild `2026-07-24-13-32`, **win64-lgpl**) | **LGPL-2.1+** (LGPL build — no GPL components)                      | https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-07-24-13-32 |
| qpdf (+ qpdf30.dll)                                       | `12.3.2` (msvc64)                                                           | **Apache-2.0**                                                      | https://github.com/qpdf/qpdf/releases/tag/v12.3.2                             |
| VC++ runtime DLLs (msvcp140\*, vcruntime140\*, concrt140) | shipped with qpdf 12.3.2 msvc64                                             | Microsoft Visual C++ Runtime redistribution terms (redistributable) | bundled in the qpdf release archive                                           |
| ImageMagick (`magick.exe`, portable Q16 x64)              | `7.1.2-27`                                                                  | **ImageMagick License** (permissive); bundles libheif + libde265 (LGPL) for HEIC decode (ADR 003) | https://github.com/ImageMagick/ImageMagick/releases/tag/7.1.2-27              |
| pdfium (`pdfium.dll`, win-x64)                            | `chromium/7961` (bblanchon/pdfium-binaries)                                 | **Apache-2.0 / BSD-3-Clause** (PDFium)                              | https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F7961     |

LGPL compliance note (FFmpeg): we bundle unmodified official BtbN LGPL builds as separate
executables (no static linking into our binary); the table above links the exact source release.

## Artwork

The application icon (`src-tauri/icons/zapit-icon.svg` and everything generated from it) is
original work created for this project and is covered by the project's MIT licence. No
third-party icon set, font or stock asset is used.

## Rust crates / npm packages

Declared in `src-tauri/Cargo.toml` and `package.json`; all MIT/Apache-2.0 dual-licensed
(Tauri ecosystem, serde, thiserror, vite, vitest, eslint, prettier). Audit before release:
`cargo license` / `npx license-checker` at M7.
