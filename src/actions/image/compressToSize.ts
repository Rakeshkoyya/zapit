import { splitName, type QuickAction } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/**
 * I3, the gov-form hero feature: "photo must be under 50 KB". The Rust runner
 * searches quality/scale (size-search step); transparency goes WebP, opaque
 * images go JPEG (§6). Option: `targetKb`.
 */
export const compressImage: QuickAction = {
  id: "compress-image",
  menuLabel: "Compress to size",
  category: "image",
  extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "heic", "heif"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: [
    { label: "Under 20 KB", options: { targetKb: "20" } },
    { label: "Under 50 KB", options: { targetKb: "50" } },
    { label: "Under 100 KB", options: { targetKb: "100" } },
    { label: "Under 200 KB", options: { targetKb: "200" } },
    { label: "Under 500 KB", options: { targetKb: "500" } },
    { label: "Custom size…", options: {} },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const raw = opts.targetKb;
    if (raw === undefined || raw.trim() === "") {
      throw new NeedsOptions("prompt-size");
    }
    const targetKb = Number(raw);
    if (!Number.isInteger(targetKb) || targetKb < 5 || targetKb > 100_000) {
      throw new PlanError(`"${raw}" is not a valid size in KB (try e.g. 50).`);
    }
    const steps: PlanStep[] = [];
    const outputs: OutputSpec[] = [];
    inputs.forEach((input, i) => {
      const { base, ext } = splitName(input.path);
      // PNG/WebP may carry transparency worth keeping → WebP; everything else JPEG.
      const format = ext === "png" || ext === "webp" ? "webp" : "jpeg";
      const outExt = format === "webp" ? "webp" : "jpg";
      if (input.sizeBytes > 0 && input.sizeBytes <= targetKb * 1024) {
        throw new PlanError(
          `"${base}" is already under ${String(targetKb)} KB (${Math.ceil(input.sizeBytes / 1024).toString()} KB).`,
        );
      }
      const temp = `{tmp}/sized-${String(i)}.${outExt}`;
      steps.push({
        kind: "size-search",
        input: `{in${String(i)}}`,
        out: temp,
        targetKb,
        format,
      });
      outputs.push({
        from: temp,
        baseName: `${base} (${String(targetKb)}KB)`,
        ext: outExt,
      });
    });
    return { steps, outputs };
  },
};
