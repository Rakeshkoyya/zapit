# Architecture (living document)

Updated at every milestone gate. High-level design lives in `IMPLEMENTATION_PLAN.md` §2;
this file records what is actually built and the concrete versions in play.

## Status

- **M0 (environment & skeleton): complete** — gate passed 2026-07-25.
- **M1 (core plumbing): complete** — gate passed 2026-07-25. Full pipe proven:
  CLI → single-instance forwarding → 400 ms aggregation → plan request to the hidden
  webview → plan execution → collision-safe outputs → toast.
- **M2 (video & audio Core): complete** — gate passed 2026-07-25. Eight actions live
  (V1–V6, A1–A2), plan-request protocol extended with probe data, PlanError (UserError)
  and needs-options round-trips; Trim window; `scripts/smoke.ps1` incl. -Heavy suite.
  **ADR 002:** LGPL FFmpeg has no libx264 → OpenH264, bitrate-driven (no CRF/two-pass).
- **M3 (image Core): complete** — gate passed 2026-07-25. I1–I4 live. **ADR 003:**
  ImageMagick sidecar (magick.exe) for HEIC decode, DPI-aware resize, ICO assembly, and
  the I3 size-search (a Rust-side `size-search` plan step: quality binary search + scale
  ladder + 4000px pre-cap, pure logic unit-tested with a mocked encoder).
- **M4 (PDF Core, risk milestone): complete** — gate passed 2026-07-25. P1/P2 run as
  `js://` steps in the webview (pdf-lib; file IO via `read_file_bytes` binary response +
  `write_file_bytes` base64 arg — raw IPC bodies proved unreliable). P3 is a Rust
  `pdf-compress` step: qpdf lossless → pdfium rasterize floor with a hand-rolled
  DCTDecode PDF writer (**ADR 004**: stage 2 deferred). pdfium.dll pinned as a sidecar.
  Reorder window submits merge order; prompt-ranges window feeds the P2 grammar.
- **M5 (extended actions): complete** — gate passed 2026-07-25. All 32 v1 actions are
  implemented (15 Core + 17 modules; P6 ships as protect + unlock). New Rust plan steps:
  `checksum` (streaming SHA-256/MD5 + constant-time compare), `loudnorm` (two-pass EBU
  R128, JSON measurements parsed from stderr), `pdf-render`/`pdf-text` (pdfium),
  `write-text` (FFmpeg concat lists). New windows: Metadata (reads EXIF itself, submits
  `strip=true`), Result (hash + compare), password Prompts. I7 rasterizes SVG through
  ImageMagick rather than a webview canvas (same rationale as ADR 003).
- **M6 (shell integration & Settings): complete** — gate passed 2026-07-25.
  `registry_menu.rs` writes per-user HKCU verbs derived from the TS action registry (the
  webview answers a `menu://request`, so there is still one source of truth). Uninstall
  removes our verb keys plus **only** the parent keys the install itself created (tracked
  in `config.created_registry_keys`) — that is what makes the registry diff empty.
  Settings window: action toggles that rewrite the menu immediately, output policy,
  third-party licenses (imported from `docs/THIRD_PARTY.md?raw`), log folder link.
- **M7 (packaging): done on the dev machine, tagged `v1.0-rc1`.** NSIS per-user installer
  (83.9 MB) bundles the four sidecars as Tauri resources; `nsis/hooks.nsh` calls the app's
  own `install-menu` / `uninstall-menu` so there is one implementation of the registry
  layout. `scripts/test-install.ps1` proves the full install → use → uninstall cycle
  leaves no files or registry keys behind. **`v1.0` still needs the clean-machine DoD
  pass** (`docs/TEST_MATRIX.md`).

## Menu presets (§7.3) — added after M7

Every action may declare `presets: ActionPreset[]` (label + options). The registry writer
turns a declaring action into a **nested flyout**: the action entry gets `SubCommands=""`
plus its own `shell` subkey, one child per preset, each with a command line carrying
`--opt k=v` before `--file "%1"`. Picking a preset therefore never opens a window.

Three pieces had to change together:

- **CLI** — the `run` verb accepts repeated `--opt k=v`; it previously took only `--file`,
  which is *why* a right-click could never carry a choice.
- **Dispatcher** — buckets are keyed by *action + options*, not action alone. Choosing
  "Under 25 MB" for some files and "Under 50 MB" for others must produce two jobs; the old
  key merged them and silently applied one choice to both.
- **Headless mode** — `smoke` refuses an action that wants an options window instead of
  blocking forever, so automation cannot hang.

A preset with **no** options is the "Custom…" entry: `buildPlan` throws `NeedsOptions` and
the prompt window opens. This replaced silent defaults — "Compress video" used to target
25 MB no matter what, because no menu entry ever passed an option.

`scripts/test-presets.ps1` installs the menu, reads every command line back out of the
registry, and runs each one headlessly against a matching sample file. It tests exactly
what a user can click.

**PowerShell note:** every `.ps1` in `scripts/` is kept **pure ASCII**. Windows PowerShell
5.1 reads script files in the machine's ANSI codepage unless they carry a UTF-8 BOM, so a
stray em-dash can break parsing on someone else's locale.

## Icon

`src-tauri/icons/my_icon.png` is the master artwork (a blue "Z"). Everything else in
`src-tauri/icons/` is generated from it and should never be edited by hand.

The master is 1007x1001, so it is centre-cropped square and normalised to a 1024 RGBA
master before the set is generated:

```powershell
src-tauri\sidecars\magick.exe src-tauri\icons\my_icon.png -gravity center -crop 1001x1001+0+0 +repage `
  -resize 1024x1024 -define png:color-type=6 PNG32:src-tauri\icons\source.png
npx tauri icon src-tauri/icons/source.png --output src-tauri/icons
```

Then delete the `android/` and `ios/` folders it emits — this is a Windows-only app.
Check the result at 16 px before shipping: that is the size the context menu uses, and an
icon that only works at 256 px is no icon at all.

> ⚠️ **Changing the icon requires clearing the build cache.** The Windows icon is compiled
> into the exe through a generated `resource.rc`, and neither Cargo nor `cargo clean -p`
> treats `icon.ico` as an input — so a rebuild happily re-links the *old* compiled
> resource. Two icon changes in a row silently shipped the original artwork before this
> was caught. After regenerating icons, always:
>
> ```powershell
> Get-ChildItem src-tauri\target\release\build, src-tauri\target\debug\build -Directory |
>   Where-Object { $_.Name -match '^zapit-' } | Remove-Item -Recurse -Force
> npm run tauri build
> ```
>
> Verify with `ExtractIconEx` against the built exe, not with Explorer — Explorer caches
> icons per file path and will keep showing the old one regardless.

## M1 architecture notes

- **Plan flow:** Rust emits `plan://request` {jobId, actionId, inputs, options} to the hidden
  main window; `src/ipc/bridge.ts` looks the action up in the registry, calls its pure
  `buildPlan`, answers via the `plan_built` command. Rust rejects empty plans.
- **Path tokens** keep plans machine-independent (golden-testable): `{tmp}`, `{inN}`, `{srcdir}`.
- **Runner:** `sidecar.rs` spawns with CREATE_NO_WINDOW, argv-only; FFmpeg gets
  `-hide_banner -nostats -progress pipe:1 -y` prepended by the runner (plans stay clean);
  `out_time_us` lines → percent vs `totalUs`; 50-line stderr ring buffer; stderr-driven
  one-shot retry (extra args inserted before the output arg); kill-on-cancel.
- **Temp lifecycle:** `%TEMP%\zapit\<job-id>\`; outputs are moved (rename, copy+delete
  fallback) to collision-safe names; the job dir is removed on every exit path.
- **Leader lifetime:** the `run`-mode dispatcher exits the app after ~3 s idle so
  Explorer-launched processes never linger. `smoke` runs one job synchronously and exits
  with 0/1; CLI feedback works via AttachConsole(ATTACH_PARENT_PROCESS).
- **Sidecar resolution:** bundled `resources/sidecars` first, then the repo's
  `src-tauri/sidecars` (dev). Resources are not yet bundled — that lands with M2/M7.
- Config `%APPDATA%\Zapit\config.json` (v1, corrupt → `.bad` + defaults); rotating
  log `%APPDATA%\Zapit\logs\zapit.log` (1 MB × 5); error taxonomy
  User/Engine/System flows from `AppError` to toasts and the job's `job://error` event.

## Toolchain (verified on the dev machine)

| Tool                                         | Version                                           |
| -------------------------------------------- | ------------------------------------------------- |
| Rust (stable-x86_64-pc-windows-msvc, rustup) | 1.97.1                                            |
| Node                                         | 24.13.0                                           |
| npm                                          | 11.6.2                                            |
| TypeScript                                   | 6.0.x                                             |
| Vite                                         | 8.1.x                                             |
| Tauri CLI / core                             | 2.11.x / 2.x                                      |
| VS 2022 Build Tools (C++ workload)           | 17.14.37                                          |
| NSIS                                         | 3.11 (auto-fetched by tauri-bundler)              |

## What exists at M0

- Tauri v2 app skeleton: hidden main window (`visible: false`), all six v1 plugins wired
  (single-instance, cli, shell, dialog, notification, clipboard-manager).
- `windows_subsystem = "windows"` in release so no console ever flashes; `smoke --help`
  short-circuits before any window exists.
- Frontend: vanilla strict TypeScript + Vite; `src/core/` (pure types), `src/actions/registry.ts`
  (empty ordered list), placeholder `main.ts`.
- `scripts/fetch-sidecars.ps1`: SHA-256-pinned FFmpeg (LGPL) + qpdf into `src-tauri/sidecars/`
  (git-ignored). Verified: both binaries run.
- `scripts/check.ps1`: prettier, eslint (typescript-eslint strictTypeChecked), tsc, vitest,
  cargo fmt/clippy `-D warnings`/test.
