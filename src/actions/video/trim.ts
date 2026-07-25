import { splitName, type QuickAction } from "../../core/action";
import { PlanError } from "../../core/planError";
import { videoStream } from "../../core/media";
import { qualityKbps } from "../../core/videoMath";
import { resolveTrimRange } from "../shared/trim";
import { h264EncodeArgs } from "../shared/h264";
import type { EnginePlan } from "../../core/plan";

/**
 * V6: precise re-encode by default (frame-accurate); "lossless" copies streams
 * and cuts at the nearest keyframe.
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
    const range = resolveTrimRange(input, opts);
    const outExt = range.lossless ? (ext === "" ? "mp4" : ext) : "mp4";
    const temp = `{tmp}/trimmed.${outExt}`;
    const spanUs = Math.round((Number(range.end) - Number(range.start)) * 1_000_000);
    const video = videoStream(input.media);
    // 0.15 bpp ≈ visually transparent for h264 (ADR 002: no CRF in OpenH264).
    const args = range.lossless
      ? ["-ss", range.start, "-to", range.end, "-i", "{in0}", "-c", "copy", temp]
      : [
          "-ss",
          range.start,
          "-to",
          range.end,
          "-i",
          "{in0}",
          ...h264EncodeArgs(qualityKbps(0.15, video?.width, video?.height)),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          temp,
        ];
    return {
      steps: [{ kind: "sidecar", bin: "ffmpeg", args, totalUs: spanUs }],
      outputs: [{ from: temp, baseName: `${base} (trimmed)`, ext: outExt }],
    };
  },
};
