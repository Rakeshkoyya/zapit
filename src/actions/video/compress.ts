import { splitName, type ActionPreset, type QuickAction } from "../../core/action";
import { durationUs, videoStream } from "../../core/media";
import { NeedsOptions, PlanError } from "../../core/planError";
import { bppForBitrate, computeBudget, qualityKbps, MIN_VIABLE_BPP } from "../../core/videoMath";
import { h264EncodeArgs } from "../shared/h264";
import type { EnginePlan } from "../../core/plan";

/**
 * V3: shrink a video, either to a chosen quality or under a chosen size.
 *
 * **The output always keeps the source resolution** — 1080p in, 1080p out.
 * Downscaling is action V11's job, so mixing it in here would silently
 * undo an explicit user choice.
 *
 * Bits-per-pixel targets for the quality presets (ADR 002: OpenH264 has no CRF,
 * so quality is expressed as a resolution-scaled bitrate).
 */
const QUALITY_BPP: Readonly<Record<string, number>> = {
  best: 0.15,
  balanced: 0.08,
  smaller: 0.045,
  // Kept for older menu entries and scripts.
  high: 0.12,
  medium: 0.07,
  low: 0.04,
};

const PRESETS: readonly ActionPreset[] = [
  { label: "Best quality", options: { quality: "best" } },
  { label: "Balanced", options: { quality: "balanced" } },
  { label: "Smaller", options: { quality: "smaller" } },
  { label: "Under 15 MB", options: { targetMb: "15" } },
  { label: "Under 25 MB", options: { targetMb: "25" } },
  { label: "Under 50 MB", options: { targetMb: "50" } },
  // No options → buildPlan asks for a size in a window.
  { label: "Custom size…", options: {} },
];

export const compressVideo: QuickAction = {
  id: "compress-video",
  menuLabel: "Compress video",
  category: "video",
  extensions: ["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: PRESETS,
  buildPlan(inputs, opts): EnginePlan {
    const input = inputs[0];
    if (input === undefined) {
      throw new PlanError("No input file.");
    }
    const { base } = splitName(input.path);
    const video = videoStream(input.media);
    if (input.media && !video) {
      throw new PlanError(`"${base}" doesn't look like a video.`);
    }
    const total = durationUs(input.media);
    const temp = "{tmp}/compressed.mp4";

    const quality = opts.quality;
    if (quality !== undefined) {
      const bpp = QUALITY_BPP[quality];
      if (bpp === undefined) {
        throw new PlanError(`Unknown quality preset "${quality}".`);
      }
      const kbps = qualityKbps(bpp, video?.width, video?.height);
      return {
        steps: [
          {
            kind: "sidecar",
            bin: "ffmpeg",
            args: [
              "-i",
              "{in0}",
              ...h264EncodeArgs(kbps),
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-movflags",
              "+faststart",
              temp,
            ],
            ...(total !== undefined ? { totalUs: total } : {}),
          },
        ],
        outputs: [{ from: temp, baseName: `${base} (compressed)`, ext: "mp4" }],
      };
    }

    // No quality and no size: the "Custom size…" entry — ask for a number.
    const rawTarget = opts.targetMb;
    if (rawTarget === undefined || rawTarget.trim() === "") {
      throw new NeedsOptions("prompt-video-size");
    }
    const targetMb = Number(rawTarget);
    if (!Number.isFinite(targetMb) || targetMb <= 0) {
      throw new PlanError(`"${rawTarget}" is not a valid size in MB.`);
    }
    const durationS = input.media?.durationS;
    if (typeof durationS !== "number" || durationS <= 0) {
      throw new PlanError(`Couldn't read the duration of "${base}".`);
    }
    const sizeMb = input.sizeBytes / (1024 * 1024);
    if (sizeMb <= targetMb) {
      throw new PlanError(
        `"${base}" is already under ${String(targetMb)} MB (${sizeMb.toFixed(1)} MB).`,
      );
    }

    const budget = computeBudget(targetMb, durationS);
    // Refuse rather than produce an unwatchable file at full resolution.
    const bpp = bppForBitrate(budget.videoKbps, video?.width, video?.height);
    if (bpp < MIN_VIABLE_BPP) {
      const minMb = Math.ceil(
        ((qualityKbps(MIN_VIABLE_BPP, video?.width, video?.height) + budget.audioKbps) *
          durationS) /
          8192,
      );
      throw new PlanError(
        `${String(targetMb)} MB is too small for this video at its full resolution — ` +
          `try ${String(minMb)} MB or more, or use "Downscale to…" first.`,
      );
    }

    return {
      steps: [
        {
          kind: "sidecar",
          bin: "ffmpeg",
          args: [
            "-i",
            "{in0}",
            ...h264EncodeArgs(budget.videoKbps),
            "-c:a",
            "aac",
            "-b:a",
            `${String(budget.audioKbps)}k`,
            "-movflags",
            "+faststart",
            temp,
          ],
          ...(total !== undefined ? { totalUs: total } : {}),
        },
      ],
      outputs: [{ from: temp, baseName: `${base} (${String(targetMb)}MB)`, ext: "mp4" }],
    };
  },
};
