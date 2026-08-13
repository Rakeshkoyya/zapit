import type { ActionOptions, FileInfo } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import { normalizeSegments, parseSegments, type Segment } from "../../core/segments";
import { formatSeconds, parseSeconds } from "../../core/time";

/**
 * Shared V6/A2 trim-window contract (ADR 005):
 *   `segments`  — `"1.5-3.2,10-12.75"`, the regions to KEEP
 *   `mode`      — "merge" (default) joins them into one file, "separate" writes one per cut
 *   `lossless`  — "true" cuts at the nearest keyframe with -c copy
 *
 * Legacy `start`/`end` are still accepted as a single segment, which keeps
 * `smoke`, `--opt` and the pre-ADR-005 golden plans working unchanged.
 */
export interface TrimSelection {
  /** Normalized, ordered, non-overlapping; always at least one. */
  readonly segments: readonly Segment[];
  readonly lossless: boolean;
  readonly merge: boolean;
}

export function resolveTrimSelection(input: FileInfo, opts: ActionOptions): TrimSelection {
  const raw = input.media?.durationS;
  const durationS = typeof raw === "number" && raw > 0 ? raw : undefined;
  const requested = readRequested(opts);
  // Clamping instead of erroring: "to the end" is what a too-large end means.
  const segments = normalizeSegments(requested, durationS);
  if (segments.length === 0) {
    if (durationS !== undefined && requested.every((s) => s.startS >= durationS)) {
      throw new PlanError(`Start is past the end of the file (${formatSeconds(durationS)} s).`);
    }
    throw new PlanError("That selection is too short to cut.");
  }
  return {
    segments,
    lossless: opts.lossless === "true",
    merge: readMode(opts) === "merge",
  };
}

function readMode(opts: ActionOptions): "merge" | "separate" {
  const mode = opts.mode;
  if (mode === undefined || mode === "" || mode === "merge") {
    return "merge";
  }
  if (mode === "separate") {
    return "separate";
  }
  throw new PlanError('Export mode must be "merge" or "separate".');
}

/** The user's raw cuts, before clamping. Throws NeedsOptions when there are none. */
function readRequested(opts: ActionOptions): readonly Segment[] {
  const raw = opts.segments;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = parseSegments(raw);
    if (parsed === undefined) {
      throw new PlanError("Cuts look like 1.5-3.2 or 0:10-0:25, separated by commas.");
    }
    if (parsed.some((s) => s.endS <= s.startS)) {
      throw new PlanError("Each cut must end after it starts.");
    }
    return parsed;
  }
  const { start, end } = opts;
  if (start === undefined || end === undefined) {
    throw new NeedsOptions("trim");
  }
  const startS = parseSeconds(start);
  const endS = parseSeconds(end);
  if (startS === undefined || endS === undefined) {
    throw new PlanError("Start and end must be times like 90, 1:30 or 0:12.5.");
  }
  if (startS < 0 || endS <= startS) {
    throw new PlanError("End must be after start.");
  }
  return [{ startS, endS }];
}
