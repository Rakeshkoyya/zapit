import { splitName, type QuickAction } from "../../core/action";
import { audioStream, durationUs } from "../../core/media";
import { PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/** A1: encoder matrix per target (§6). */
type Target = "mp3" | "wav" | "flac" | "m4a" | "ogg";

const ENCODER: Readonly<Record<Target, readonly string[]>> = {
  mp3: ["-c:a", "libmp3lame", "-q:a", "2"],
  wav: ["-c:a", "pcm_s16le"],
  flac: ["-c:a", "flac"],
  m4a: ["-c:a", "aac", "-b:a", "256k"],
  ogg: ["-c:a", "libvorbis", "-q:a", "6"],
};

/** Codec already matching the target container = pointless conversion. */
const SAME: Readonly<Record<Target, readonly string[]>> = {
  mp3: ["mp3"],
  wav: ["pcm_s16le", "pcm_s24le", "pcm_f32le"],
  flac: ["flac"],
  m4a: ["aac", "alac"],
  ogg: ["vorbis"],
};

export const convertAudio: QuickAction = {
  id: "convert-audio",
  menuLabel: "Convert to",
  category: "audio",
  extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: (Object.keys(ENCODER) as Target[]).map((t) => ({
    label: t.toUpperCase(),
    options: { target: t },
  })),
  buildPlan(inputs, opts): EnginePlan {
    const raw = opts.target;
    if (raw === undefined || !(raw in ENCODER)) {
      throw new PlanError("Choose a target format (mp3, wav, flac, m4a or ogg).");
    }
    const target = raw as Target;
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      const codec = audioStream(input.media)?.codec ?? "";
      if (ext === target || SAME[target].includes(codec)) {
        throw new PlanError(`"${base}" is already ${target.toUpperCase()}.`);
      }
      const temp = `{tmp}/audio-${String(i)}.${target}`;
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: ["-i", `{in${String(i)}}`, "-vn", ...ENCODER[target], temp],
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: base, ext: target });
    });
    return { steps, outputs };
  },
};
