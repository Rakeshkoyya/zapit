import { splitName, type QuickAction } from "../../core/action";
import { parseResizeSpec } from "../../core/imageSpec";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/**
 * I2: resize to an exact spec — percent, pixels, or cm@dpi (gov-form phrasing).
 * ImageMagick does the work: it can force exact geometry AND write DPI
 * metadata, which FFmpeg cannot (ADR 003). Option: `spec`.
 */
export const resizeImage: QuickAction = {
  id: "resize-image",
  menuLabel: "Resize",
  category: "image",
  extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "heic", "heif"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: [
    { label: "Half size (50%)", options: { spec: "50%" } },
    { label: "Quarter size (25%)", options: { spec: "25%" } },
    { label: "1920 px wide", options: { spec: "1920w" } },
    { label: "1280 px wide", options: { spec: "1280w" } },
    { label: "800 px wide", options: { spec: "800w" } },
    { label: "Passport 3.5×4.5 cm @ 300 dpi", options: { spec: "3.5x4.5cm@300dpi" } },
    { label: "Custom size…", options: {} },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const raw = opts.spec;
    if (raw === undefined || raw.trim() === "") {
      throw new NeedsOptions("prompt-resize");
    }
    const spec = parseResizeSpec(raw);
    if (spec === undefined) {
      throw new PlanError(
        `"${raw}" is not a size I understand — try 50%, 800x600, 800w or 3.5x4.5cm@200dpi.`,
      );
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      const outExt = ext === "heic" || ext === "heif" || ext === "" ? "jpg" : ext;
      const temp = `{tmp}/resized-${String(i)}.${outExt}`;
      const args = [`{in${String(i)}}`, "-auto-orient", "-resize", spec.geometry];
      if (spec.densityDpi !== undefined) {
        args.push("-density", String(spec.densityDpi), "-units", "pixelsperinch");
      }
      args.push(temp);
      steps.push({ kind: "sidecar", bin: "magick", args });
      outputs.push({ from: temp, baseName: `${base} (resized)`, ext: outExt });
    });
    return { steps, outputs };
  },
};
