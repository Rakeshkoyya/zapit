import { splitName, type QuickAction } from "../../core/action";
import { audioStream, durationUs, videoStream } from "../../core/media";
import { PlanError } from "../../core/planError";
import { qualityKbps } from "../../core/videoMath";
import { h264EncodeArgs } from "../shared/h264";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/**
 * V4 container/codec matrix (§6): copy streams when the target container can
 * hold them (a remux, seconds), re-encode otherwise.
 */
type Target = "mp4" | "mkv" | "webm" | "mov";

const TARGETS: readonly Target[] = ["mp4", "mkv", "webm", "mov"];
const MP4_SAFE_VIDEO = new Set(["h264", "hevc", "av1", "mpeg4"]);
const MP4_SAFE_AUDIO = new Set(["aac", "mp3", "ac3", "eac3"]);

export const convertVideo: QuickAction = {
  id: "convert-video",
  menuLabel: "Convert to",
  category: "video",
  extensions: ["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: TARGETS.map((t) => ({ label: t.toUpperCase(), options: { target: t } })),
  buildPlan(inputs, opts): EnginePlan {
    const raw = opts.target ?? "mp4";
    if (!(TARGETS as readonly string[]).includes(raw)) {
      throw new PlanError(`Unknown target format "${raw}".`);
    }
    const target = raw as Target;
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      if (ext === target) {
        throw new PlanError(`"${base}" is already ${target.toUpperCase()}.`);
      }
      const video = videoStream(input.media)?.codec ?? "";
      const audio = audioStream(input.media)?.codec ?? "";
      const temp = `{tmp}/conv-${String(i)}.${target}`;
      const args = ["-i", `{in${String(i)}}`];
      switch (target) {
        case "mkv":
          // MKV holds practically anything: always a remux.
          args.push("-c", "copy");
          break;
        case "mp4":
        case "mov": {
          const copyOk = MP4_SAFE_VIDEO.has(video) && (audio === "" || MP4_SAFE_AUDIO.has(audio));
          if (copyOk) {
            args.push("-c", "copy");
            if (video === "hevc") {
              args.push("-tag:v", "hvc1");
            }
          } else {
            // 0.09 bpp ≈ "good default" h264 quality (ADR 002).
            const stream = videoStream(input.media);
            args.push(...h264EncodeArgs(qualityKbps(0.09, stream?.width, stream?.height)));
            args.push("-c:a", "aac", "-b:a", "192k");
          }
          if (target === "mp4") {
            args.push("-movflags", "+faststart");
          }
          break;
        }
        case "webm":
          args.push("-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0");
          args.push("-c:a", "libopus");
          break;
      }
      args.push(temp);
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args,
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: base, ext: target });
    });
    return { steps, outputs };
  },
};
