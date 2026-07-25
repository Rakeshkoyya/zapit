import { splitName, type QuickAction } from "../../core/action";
import { PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/**
 * I1: PNG/JPG/WebP via FFmpeg (§6); multi-size ICO assembled by ImageMagick
 * (`icon:auto-resize` — ADR 003 supersedes the ico crate).
 */
type Target = "png" | "jpg" | "webp" | "ico";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "gif", "heic", "heif"];

export const convertImage: QuickAction = {
  id: "convert-image",
  menuLabel: "Convert to",
  category: "image",
  extensions: IMAGE_EXTENSIONS,
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: [
    { label: "PNG", options: { target: "png" } },
    { label: "JPG", options: { target: "jpg" } },
    { label: "WebP", options: { target: "webp" } },
    { label: "ICO (icon)", options: { target: "ico" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const raw = opts.target ?? "png";
    if (!["png", "jpg", "webp", "ico"].includes(raw)) {
      throw new PlanError(`Unknown image format "${raw}".`);
    }
    const target = raw as Target;
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      if (ext === target || (target === "jpg" && ext === "jpeg")) {
        throw new PlanError(`"${base}" is already ${target.toUpperCase()}.`);
      }
      const heic = ext === "heic" || ext === "heif";
      const temp = `{tmp}/img-${String(i)}.${target}`;
      const inputToken = `{in${String(i)}}`;
      // An animated GIF is a video to FFmpeg: without these it tries to write a
      // numbered image sequence and fails. Take the first frame instead.
      const stillFrame = ext === "gif" ? ["-frames:v", "1", "-update", "1"] : [];
      switch (target) {
        case "ico":
          steps.push({
            kind: "sidecar",
            bin: "magick",
            args: [inputToken, "-define", "icon:auto-resize=256,48,32,16", temp],
          });
          break;
        case "jpg":
          if (heic) {
            steps.push({
              kind: "sidecar",
              bin: "magick",
              args: [inputToken, "-auto-orient", "-quality", "92", temp],
            });
          } else {
            // format=rgb24 flattens alpha instead of surprising with black.
            steps.push({
              kind: "sidecar",
              bin: "ffmpeg",
              args: ["-i", inputToken, "-vf", "format=rgb24", ...stillFrame, "-q:v", "2", temp],
            });
          }
          break;
        case "png":
        case "webp": {
          if (heic) {
            steps.push({
              kind: "sidecar",
              bin: "magick",
              args: [inputToken, "-auto-orient", temp],
            });
          } else {
            const quality = target === "webp" ? ["-quality", "90"] : [];
            steps.push({
              kind: "sidecar",
              bin: "ffmpeg",
              args: ["-i", inputToken, ...stillFrame, ...quality, temp],
            });
          }
          break;
        }
      }
      outputs.push({ from: temp, baseName: base, ext: target });
    });
    return { steps, outputs };
  },
};
