import { splitName, type QuickAction } from "../../core/action";
import { PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/**
 * I4: the iPhone photo fixer. ImageMagick decodes HEIC (ADR 003 — the LGPL
 * FFmpeg build cannot). Option `target`: jpg (default) or png.
 */
export const heicConvert: QuickAction = {
  id: "heic-convert",
  menuLabel: "HEIC → JPG",
  category: "image",
  extensions: ["heic", "heif"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: [
    { label: "JPG", options: { target: "jpg" } },
    { label: "PNG", options: { target: "png" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const target = opts.target ?? "jpg";
    if (target !== "jpg" && target !== "png") {
      throw new PlanError(`HEIC converts to jpg or png, not "${target}".`);
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base } = splitName(input.path);
      const temp = `{tmp}/heic-${String(i)}.${target}`;
      const args = [`{in${String(i)}}`, "-auto-orient"];
      if (target === "jpg") {
        args.push("-quality", "92");
      }
      args.push(temp);
      steps.push({ kind: "sidecar", bin: "magick", args });
      outputs.push({ from: temp, baseName: base, ext: target });
    });
    return { steps, outputs };
  },
};
