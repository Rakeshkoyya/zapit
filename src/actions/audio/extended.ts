import { splitName, type FileInfo, type QuickAction } from "../../core/action";
import { audioStream, durationUs } from "../../core/media";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

const AUDIO_EXT = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"];

/** A3: broadcast-style loudness (the Rust step runs the two passes). */
export const normalizeAudio: QuickAction = {
  id: "normalize-audio",
  menuLabel: "Normalize loudness",
  category: "audio",
  extensions: AUDIO_EXT,
  multiFile: "both",
  edition: "free",
  tier: "extended",
  buildPlan(inputs): EnginePlan {
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      // wma has no encoder in the LGPL build; normalize into m4a instead.
      const outExt = ext === "wma" || ext === "" ? "m4a" : ext;
      const temp = `{tmp}/norm-${String(i)}.${outExt}`;
      steps.push({ kind: "loudnorm", input: `{in${String(i)}}`, out: temp });
      outputs.push({ from: temp, baseName: `${base} (normalized)`, ext: outExt });
    });
    return { steps, outputs };
  },
};

/** A4: concat when parameters match, decode-concat filter otherwise (§6). */
export const mergeAudio: QuickAction = {
  id: "merge-audio",
  menuLabel: "Merge audio",
  category: "audio",
  extensions: AUDIO_EXT,
  multiFile: "multi",
  edition: "free",
  tier: "extended",
  buildPlan(inputs, opts): EnginePlan {
    if (inputs.length < 2) {
      throw new PlanError("Select at least two audio files to merge.");
    }
    if (opts.ordered !== "true") {
      throw new NeedsOptions("reorder");
    }
    let order = inputs.map((_, i) => i);
    if (opts.order !== undefined && opts.order !== "") {
      const parsed = opts.order.split(",").map((n) => Number(n.trim()));
      if (
        parsed.length !== inputs.length ||
        !parsed.every((n) => Number.isInteger(n) && n >= 0 && n < inputs.length) ||
        new Set(parsed).size !== parsed.length
      ) {
        throw new PlanError("The file order looks corrupted — try again.");
      }
      order = parsed;
    }
    const ordered = order.map((i) => inputs[i]).filter((f): f is FileInfo => f !== undefined);
    const { base, ext } = splitName(ordered[0]?.path ?? "merged");
    const outExt = ext === "wma" || ext === "" ? "m4a" : ext;
    const firstCodec = audioStream(ordered[0]?.media)?.codec;
    const uniform =
      firstCodec !== undefined && ordered.every((f) => audioStream(f.media)?.codec === firstCodec);
    const out = `{tmp}/merged.${outExt}`;
    const steps: PlanStep[] = [];

    if (uniform) {
      const listLines = order
        .map((i) => `file '${`{in${String(i)}}`.replace(/'/g, "'\\''")}'`)
        .join("\n");
      steps.push({ kind: "write-text", path: "{tmp}/list.txt", content: listLines });
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: ["-f", "concat", "-safe", "0", "-i", "{tmp}/list.txt", "-c", "copy", out],
      });
    } else {
      const args: string[] = [];
      for (const i of order) {
        args.push("-i", `{in${String(i)}}`);
      }
      const refs = order.map((_, p) => `[${String(p)}:a]`).join("");
      args.push(
        "-filter_complex",
        `${refs}concat=n=${String(order.length)}:v=0:a=1[a]`,
        "-map",
        "[a]",
        out,
      );
      steps.push({ kind: "sidecar", bin: "ffmpeg", args });
    }
    return { steps, outputs: [{ from: out, baseName: `${base} (merged)`, ext: outExt }] };
  },
};

/** A5: simple gain. Loud sources clip — normalize (A3) is the smarter button. */
export const boostVolume: QuickAction = {
  id: "boost-volume",
  menuLabel: "Boost volume",
  category: "audio",
  extensions: AUDIO_EXT,
  multiFile: "both",
  edition: "free",
  tier: "extended",
  presets: [
    { label: "1.5× louder", options: { factor: "1.5" } },
    { label: "2× louder", options: { factor: "2" } },
    { label: "3× louder", options: { factor: "3" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const factor = opts.factor ?? "1.5";
    if (!/^\d+(\.\d+)?$/.test(factor) || Number(factor) <= 1 || Number(factor) > 4) {
      throw new PlanError("The volume factor must be between 1 and 4 (e.g. 1.5 or 2).");
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      const outExt = ext === "wma" || ext === "" ? "m4a" : ext;
      const temp = `{tmp}/loud-${String(i)}.${outExt}`;
      const total = durationUs(input.media);
      steps.push({
        kind: "sidecar",
        bin: "ffmpeg",
        args: ["-i", `{in${String(i)}}`, "-af", `volume=${factor}`, temp],
        ...(total !== undefined ? { totalUs: total } : {}),
      });
      outputs.push({ from: temp, baseName: `${base} (${factor}x)`, ext: outExt });
    });
    return { steps, outputs };
  },
};
