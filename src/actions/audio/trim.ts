import { splitName, type QuickAction } from "../../core/action";
import { audioStream } from "../../core/media";
import { PlanError } from "../../core/planError";
import { formatSeconds } from "../../core/time";
import { resolveTrimSelection } from "../shared/trim";
import { buildSegmentPlan } from "../shared/segmentPlan";
import type { EnginePlan } from "../../core/plan";

/**
 * A2: the "online audio cutter" replacement, sharing the timeline window with
 * V6. mp3/flac cut with -c copy (frame-accurate enough, §6); other formats
 * re-encode in their own codec; wma re-encodes to m4a (no sane wma encoder).
 * Multiple cuts merge or export separately exactly as for video (ADR 005).
 */
const REENCODER: Readonly<Record<string, { args: readonly string[]; ext: string }>> = {
  m4a: { args: ["-c:a", "aac", "-b:a", "256k"], ext: "m4a" },
  aac: { args: ["-c:a", "aac", "-b:a", "256k"], ext: "m4a" },
  wav: { args: ["-c:a", "pcm_s16le"], ext: "wav" },
  ogg: { args: ["-c:a", "libvorbis", "-q:a", "6"], ext: "ogg" },
  opus: { args: ["-c:a", "libopus"], ext: "opus" },
  wma: { args: ["-c:a", "aac", "-b:a", "256k"], ext: "m4a" },
};

export const trimAudio: QuickAction = {
  id: "trim-audio",
  menuLabel: "Trim…",
  category: "audio",
  extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"],
  multiFile: "single",
  edition: "free",
  tier: "core",
  buildPlan(inputs, opts): EnginePlan {
    const input = inputs[0];
    if (input === undefined) {
      throw new PlanError("No input file.");
    }
    const { base, ext } = splitName(input.path);
    if (input.media && !audioStream(input.media)) {
      throw new PlanError(`"${base}" has no audio.`);
    }
    const selection = resolveTrimSelection(input, opts);
    const copy = selection.lossless || ext === "mp3" || ext === "flac";
    const out = copy
      ? { args: ["-c", "copy"] as readonly string[], ext: ext === "" ? "mp3" : ext }
      : (REENCODER[ext] ?? { args: ["-c:a", "aac", "-b:a", "256k"], ext: "m4a" });
    return buildSegmentPlan({
      segments: selection.segments,
      merge: selection.merge,
      base,
      ext: out.ext,
      cut: (segment, dest) => [
        "-ss",
        formatSeconds(segment.startS),
        "-to",
        formatSeconds(segment.endS),
        "-i",
        "{in0}",
        ...out.args,
        dest,
      ],
    });
  },
};
