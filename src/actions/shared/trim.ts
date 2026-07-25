import type { ActionOptions, FileInfo } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import { formatSeconds, parseSeconds } from "../../core/time";

/**
 * Shared V6/A2 trim-window contract: options `start`/`end` (seconds or m:ss),
 * `lossless` ("true" cuts at the nearest keyframe with -c copy).
 */
export interface TrimRange {
  readonly start: string;
  readonly end: string;
  readonly lossless: boolean;
}

export function resolveTrimRange(input: FileInfo, opts: ActionOptions): TrimRange {
  const rawStart = opts.start;
  const rawEnd = opts.end;
  if (rawStart === undefined || rawEnd === undefined) {
    throw new NeedsOptions("trim");
  }
  const start = parseSeconds(rawStart);
  const end = parseSeconds(rawEnd);
  if (start === undefined || end === undefined) {
    throw new PlanError("Start and end must be times like 90, 1:30 or 0:12.5.");
  }
  const duration = input.media?.durationS;
  if (start < 0 || end <= start) {
    throw new PlanError("End must be after start.");
  }
  if (typeof duration === "number" && duration > 0 && start >= duration) {
    throw new PlanError(`Start is past the end of the file (${formatSeconds(duration)} s).`);
  }
  return {
    start: formatSeconds(start),
    // Clamp instead of erroring: "to the end" is what a too-large end means.
    end:
      typeof duration === "number" && duration > 0 && end > duration
        ? formatSeconds(duration)
        : formatSeconds(end),
    lossless: opts.lossless === "true",
  };
}
