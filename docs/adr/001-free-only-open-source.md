# ADR 001 — Ship Free edition only, as open source (Pro parked)

Date: 2026-07-25 · Status: accepted

## Context

The original v1.0 contract (GOALS.md) planned two editions from one codebase: a lean Free
edition and a paid, closed-source Pro edition (offline AI actions, Ed25519 license keys,
payment-provider distribution). The project owner has decided to release Zapit as a
free, open-source tool and park the commercial Pro edition indefinitely.

## Decision

1. **v1 scope = Free edition only.** Milestones M8–M10 (Pro licensing, Pro AI actions,
   Pro packaging) are parked. M7 (Free packaging) becomes the release milestone; its gate
   produces the `v1.0` tag (previously `v1.0-free-rc`).
2. **The code is licensed MIT** (see `LICENSE`). Bundled third-party binaries keep their own
   licenses, recorded in `docs/THIRD_PARTY.md`.
3. **The permissive-dependency rule stays.** Runtime dependencies remain MIT/BSD/Apache/LGPL
   only; FFmpeg stays the LGPL build. Rationale changes from "Pro is sold closed-source" to:
   (a) keeps the MIT license clean and unencumbered for downstream users, and (b) keeps the
   parked Pro option open without a future relicensing exercise. GPL reference repos
   (p2r3/convert) remain ideas-only, never copied.
4. **No Pro scaffolding.** `edition: "pro"` stays in the `QuickAction` type (it is one string
   literal and keeps the registry future-proof), but no license service, no `ai/` module,
   no model fetching, no key tooling gets written.

## Consequences

- Simpler v1: no license service, no key entry UI, no Pro installer components, no ONNX/
  Whisper/ESRGAN sidecars — the highest-complexity subsystems drop out of scope.
- The business checklist in IMPLEMENTATION_PLAN.md §9 shrinks: no payment provider, no EULA
  for a paid product. Code signing remains desirable (SmartScreen) but is no longer
  release-blocking for a free tool; the release can ship unsigned with a documented caveat.
- Distribution becomes a public GitHub repository with tagged releases.
- Reviving Pro later requires amending GOALS.md first (its own commit) and un-parking
  M8–M10; nothing in this decision makes that harder beyond writing the parked code.
