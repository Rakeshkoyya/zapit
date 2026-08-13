/**
 * Time-interval math for the multi-cut Trim window (V6/A2, ADR 005).
 *
 * A segment is always a *keep* region: the window resolves its Keep/Remove
 * toggle before submitting, so `segments` on the wire has exactly one meaning
 * and `buildPlan` never has to know which mode the user was in.
 *
 * Wire form: `"1.5-3.2,10-12.75"` — comma-separated `start-end` pairs. Each
 * half goes through `parseSeconds`, so `1:30-2:00` is accepted too.
 */
import { formatSeconds, parseSeconds } from "./time";

export interface Segment {
  readonly startS: number;
  readonly endS: number;
}

/**
 * Shorter than this and there is no frame to cut — a stray click on the
 * timeline should not become a zero-length clip that makes FFmpeg write
 * nothing and the job fail with "that produced no output".
 */
export const MIN_SEGMENT_S = 0.05;

/** `"1.5-3.2,10-12.75"` → segments; undefined when any pair is malformed. */
export function parseSegments(text: string): readonly Segment[] | undefined {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) {
    return undefined;
  }
  const out: Segment[] = [];
  for (const part of parts) {
    const halves = part.split("-");
    if (halves.length !== 2) {
      return undefined;
    }
    const startS = parseSeconds(halves[0] ?? "");
    const endS = parseSeconds(halves[1] ?? "");
    if (startS === undefined || endS === undefined) {
      return undefined;
    }
    out.push({ startS, endS });
  }
  return out;
}

/** Segments → wire form, rounded the same way FFmpeg args are. */
export function formatSegments(segments: readonly Segment[]): string {
  return segments.map((s) => `${formatSeconds(s.startS)}-${formatSeconds(s.endS)}`).join(",");
}

/**
 * Clamp into `[0, durationS]`, drop anything too short to cut, sort by start,
 * and fuse overlapping or touching regions. Dragging two regions until they
 * meet should produce one clip, not two clips with a seam in the middle.
 */
export function normalizeSegments(
  segments: readonly Segment[],
  durationS?: number,
): readonly Segment[] {
  const limit = typeof durationS === "number" && durationS > 0 ? durationS : undefined;
  const clamped = segments
    .map((s) => {
      const lo = Math.max(0, Math.min(s.startS, s.endS));
      const hi = Math.max(s.startS, s.endS);
      return { startS: lo, endS: limit === undefined ? hi : Math.min(hi, limit) };
    })
    .filter((s) => s.endS - s.startS >= MIN_SEGMENT_S)
    .sort((a, b) => a.startS - b.startS);

  const merged: Segment[] = [];
  for (const seg of clamped) {
    const last = merged[merged.length - 1];
    if (last !== undefined && seg.startS <= last.endS) {
      merged[merged.length - 1] = { startS: last.startS, endS: Math.max(last.endS, seg.endS) };
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

/**
 * Remove-mode → keep-mode: the gaps between the marked regions, plus the head
 * and tail. Marking nothing keeps the whole file; marking everything keeps
 * none, which the caller reports as "nothing left to export".
 */
export function invertSegments(
  segments: readonly Segment[],
  durationS: number,
): readonly Segment[] {
  if (!(durationS > 0)) {
    return [];
  }
  const marked = normalizeSegments(segments, durationS);
  const kept: Segment[] = [];
  let cursor = 0;
  for (const seg of marked) {
    if (seg.startS - cursor >= MIN_SEGMENT_S) {
      kept.push({ startS: cursor, endS: seg.startS });
    }
    cursor = Math.max(cursor, seg.endS);
  }
  if (durationS - cursor >= MIN_SEGMENT_S) {
    kept.push({ startS: cursor, endS: durationS });
  }
  return kept;
}

/** Total playing time of the assembled result — the window's summary line. */
export function totalSeconds(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.endS - s.startS), 0);
}
