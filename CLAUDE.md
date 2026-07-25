# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**Zapit** — a Windows 11 right-click context-menu utility (Tauri v2, Rust + strict TypeScript)
that performs quick file operations offline: extract audio, compress video/images/PDFs to target
sizes, merge PDFs, HEIC conversion, etc. **Free and open source (MIT).** A paid Pro edition
(offline AI actions) was originally planned and is **parked indefinitely** — see
`docs/adr/001-free-only-open-source.md`; build nothing Pro (milestones M8–M10 are parked).

## Read these first, in order

1. **`GOALS.md`** — the frozen scope contract: every action, its tier (Core/Extended/Stretch),
   its edition (Free/Pro), the non-goals, and the Definition of Done. Do not build anything not
   listed there; changing scope requires editing GOALS.md first, in its own commit.
2. **`IMPLEMENTATION_PLAN.md`** — the build plan: stack (§1, decided — do not relitigate),
   architecture (§2), subsystem specs (§5), per-action techniques (§6), and the milestone
   sequence (§10) with gates and checkboxes.

## How to work here

- Follow the milestones in `IMPLEMENTATION_PLAN.md` §10 **in order**. Tick checkboxes as tasks
  complete and update the `Status:` line at the top of that file.
- A milestone is finished only when its **Gate** passes — run it, don't assume it.
- Deviating from the plan requires an ADR in `docs/adr/` (numbered, short: context → decision →
  consequences) written *before* the deviation.
- Quality bar is `IMPLEMENTATION_PLAN.md` §12. Non-negotiables: strict TS with zero `any`;
  `cargo clippy -- -D warnings` clean; no `unwrap`/`expect` in production Rust paths; action
  modules stay pure (`buildPlan` returns data, never spawns processes); golden-plan tests for
  every action; `scripts/check.ps1` green before every commit.
- **License rule:** every runtime dependency must be MIT/BSD/Apache/LGPL. No GPL/AGPL, ever —
  the project itself is MIT and must stay unencumbered (and the parked Pro option stays open).
  FFmpeg must be the LGPL build. Record every bundled binary in `docs/THIRD_PARTY.md`.
  Reference repos p2r3/convert (GPL) may be read for ideas, **never copied**.
- Never commit binaries (sidecars come from `scripts/fetch-sidecars.ps1`).

## Commands

Not scaffolded yet (Milestone M0 pending). Once M0 completes, this section must be updated with:
dev run, `scripts/check.ps1` (fmt+lint+clippy+tests), `scripts/smoke.ps1`, and `tauri build`.

## Reference material (read-only)

Clones of the inspiration repos live at `D:\real_projects\sammy\convert\convert` and
`D:\real_projects\sammy\convert\envelope` — study the handler-registry pattern and FFmpeg
error-recovery tricks there, but remember: GPL, ideas only, no code copying.
