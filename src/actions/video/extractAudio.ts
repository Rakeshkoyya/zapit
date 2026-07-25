import { splitName, type QuickAction } from "../../core/action";
import { audioStream, durationUs } from "../../core/media";
import { PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/** V1: stream-copy into the codec's native container; MP3 re-encode fallback. */
const NATIVE_CONTAINER: Readonly<Record<string, string>> = {
  aac: "m4a",
  alac: "m4a",
  mp3: "mp3",
  opus: "opus",
  vorbis: "ogg",
  flac: "flac",
};

export const extractAudio: QuickAction = {
  id: "extract-audio",
  menuLabel: "Extract audio",
  category: "video",
  extensions: ["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  buildPlan(inputs): EnginePlan {
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const audio = audioStream(input.media);
      if (input.media && !audio) {
        throw new PlanError(`"${base}" has no audio track.`);
      }
      const codec = audio?.codec ?? "";
      const container = NATIVE_CONTAINER[codec] ?? (codec.startsWith("pcm_") ? "wav" : undefined);
      const temp = `{tmp}/audio-${String(i)}.${container ?? "mp3"}`;
      const args =
        container !== undefined
          ? ["-i", `{in${String(i)}}`, "-vn", "-acodec", "copy", temp]
          : ["-i", `{in${String(i)}}`, "-vn", "-c:a", "libmp3lame", "-q:a", "2", temp];
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args,
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: base, ext: container ?? "mp3" });
    });
    return { steps, outputs };
  },
};
