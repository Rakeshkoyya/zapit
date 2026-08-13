import { splitName, type QuickAction } from "../../core/action";
import { PlanError } from "../../core/planError";
import { videoStream } from "../../core/media";
import { formatSeconds } from "../../core/time";
import { qualityKbps } from "../../core/videoMath";
import { resolveTrimSelection } from "../shared/trim";
import { buildSegmentPlan } from "../shared/segmentPlan";
import { h264EncodeArgs } from "../shared/h264";
import type { EnginePlan } from "../../core/plan";

/**
 * V6: precise re-encode by default (frame-accurate); "lossless" copies streams
 * and cuts at the nearest keyframe. Multiple cuts merge through the concat
 * demuxer or come out as separate clips (ADR 005).
 */
export const trimVideo: QuickAction = {
  id: "trim-video",
  menuLabel: "Trim…",
  category: "video",
  extensions: ["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp"],
  multiFile: "single",
  edition: "free",
  tier: "core",
  buildPlan(inputs, opts): EnginePlan {
    const input = inputs[0];
    if (input === undefined) {
      throw new PlanError("No input file.");
    }
    const { base, ext } = splitName(input.path);
    if (!videoStream(input.media)) {
      throw new PlanError(`"${base}" doesn't look like a video.`);
    }
    const selection = resolveTrimSelection(input, opts);
    const outExt = selection.lossless ? (ext === "" ? "mp4" : ext) : "mp4";
    const video = videoStream(input.media);
    // 0.15 bpp ≈ visually transparent for h264 (ADR 002: no CRF in OpenH264).
    // Every segment shares these args, which is what lets the concat demuxer
    // stitch them without a re-encode.
    const encode = selection.lossless
      ? ["-c", "copy"]
      : [
          ...h264EncodeArgs(qualityKbps(0.15, video?.width, video?.height)),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
        ];
    return buildSegmentPlan({
      segments: selection.segments,
      merge: selection.merge,
      base,
      ext: outExt,
      cut: (segment, out) => [
        "-ss",
        formatSeconds(segment.startS),
        "-to",
        formatSeconds(segment.endS),
        "-i",
        "{in0}",
        ...encode,
        out,
      ],
    });
  },
};
