import { splitName, type QuickAction } from "../../core/action";
import { audioStream, durationUs, videoStream } from "../../core/media";
import { PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/** V2: container swap into MP4, no re-encode — the "fix my OBS .mkv" button. */
const MP4_VIDEO = new Set(["h264", "hevc", "av1", "mpeg4"]);
const MP4_AUDIO = new Set(["aac", "mp3", "ac3", "eac3", "opus"]);

export const remuxMp4: QuickAction = {
  id: "remux-mp4",
  menuLabel: "Remux to MP4",
  category: "video",
  extensions: ["mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  buildPlan(inputs): EnginePlan {
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const video = videoStream(input.media);
      const audio = audioStream(input.media);
      if (!video || !MP4_VIDEO.has(video.codec) || (audio && !MP4_AUDIO.has(audio.codec))) {
        throw new PlanError(
          `"${base}" can't be remuxed losslessly — use "Convert to MP4" instead.`,
        );
      }
      const temp = `{tmp}/remux-${String(i)}.mp4`;
      const args = ["-i", `{in${String(i)}}`, "-c", "copy"];
      if (video.codec === "hevc") {
        args.push("-tag:v", "hvc1");
      }
      args.push("-movflags", "+faststart", temp);
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args,
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: base, ext: "mp4" });
    });
    return { steps, outputs };
  },
};
