import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";
import type { Segment } from "../../core/segments";

/**
 * Turns N keep-regions into a plan (ADR 005). Each segment is cut with its own
 * fast-seeking FFmpeg step; merging then stitches them with the concat demuxer
 * rather than one `trim`/`concat` filter pass, which would decode the whole
 * source no matter where the cuts sit.
 */
export interface SegmentPlanSpec {
  readonly segments: readonly Segment[];
  readonly merge: boolean;
  /** Source file's base name, e.g. "holiday" — output names are built from it. */
  readonly base: string;
  /** Output extension, shared by every segment and the merged result. */
  readonly ext: string;
  /**
   * Argv for one cut, ending with `out`. Keeps codec choices with the action.
   * A property rather than a method so destructuring it cannot lose `this`.
   */
  readonly cut: (segment: Segment, out: string) => readonly string[];
}

function spanUs(segment: Segment): number {
  return Math.round((segment.endS - segment.startS) * 1_000_000);
}

export function buildSegmentPlan(spec: SegmentPlanSpec): EnginePlan {
  const { segments, merge, base, ext, cut } = spec;
  const joined = merge && segments.length > 1;
  const single = segments.length === 1;
  const steps: PlanStep[] = [];
  const outputs: OutputSpec[] = [];
  const parts: string[] = [];

  segments.forEach((segment, i) => {
    // One cut keeps the historical temp name and label, so the single-segment
    // plan stays byte-identical to the pre-ADR-005 one (golden regression).
    const name = joined
      ? `seg-${String(i)}.${ext}`
      : single
        ? `trimmed.${ext}`
        : `clip-${String(i)}.${ext}`;
    const out = `{tmp}/${name}`;
    parts.push(name);
    steps.push({
      kind: "sidecar",
      bin: "ffmpeg",
      args: cut(segment, out),
      totalUs: spanUs(segment),
    });
    if (!joined) {
      outputs.push({
        from: out,
        baseName: single ? `${base} (trimmed)` : `${base} (clip ${String(i + 1)})`,
        ext,
      });
    }
  });

  if (joined) {
    const out = `{tmp}/trimmed.${ext}`;
    // Bare names, not `{tmp}/…` tokens: the concat demuxer resolves relative
    // entries against the list file's own directory, so a temp path containing
    // an apostrophe cannot break the quoting. (We could not escape it here
    // anyway — Rust substitutes `{tmp}` long after this string is built.)
    steps.push({
      kind: "write-text",
      path: "{tmp}/list.txt",
      content: parts.map((name) => `file '${name}'`).join("\n"),
    });
    steps.push({
      kind: "sidecar",
      bin: "ffmpeg",
      args: ["-f", "concat", "-safe", "0", "-i", "{tmp}/list.txt", "-c", "copy", out],
      totalUs: segments.reduce((sum, segment) => sum + spanUs(segment), 0),
    });
    outputs.push({ from: out, baseName: `${base} (trimmed)`, ext });
  }

  return { steps, outputs };
}
