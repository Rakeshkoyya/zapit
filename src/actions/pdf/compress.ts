import { splitName, type QuickAction } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec, PlanStep } from "../../core/plan";

/**
 * P3: shrink a PDF, either to a chosen quality or under a chosen size (ADR 004).
 *
 * Quality levels exist for people who just want "smaller" and have no size in
 * mind. Only **High** keeps the text selectable — Medium and Low turn pages
 * into images, so the labels say so rather than surprising anyone.
 */
const QUALITY = ["high", "medium", "low"] as const;

export const compressPdf: QuickAction = {
  id: "compress-pdf",
  // No trailing "…": Windows reserves that for entries that open a dialog, and
  // this one opens a flyout. The "Custom size…" child keeps the ellipsis.
  menuLabel: "Compress",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "both",
  edition: "free",
  tier: "core",
  presets: [
    { label: "High quality (keeps text)", options: { quality: "high" } },
    { label: "Medium quality (pages become images)", options: { quality: "medium" } },
    { label: "Low quality (smallest)", options: { quality: "low" } },
    { label: "Under 500 KB", options: { targetKb: "500" } },
    { label: "Under 1 MB", options: { targetKb: "1000" } },
    { label: "Under 2 MB", options: { targetKb: "2000" } },
    { label: "Under 5 MB", options: { targetKb: "5000" } },
    { label: "Custom size…", options: {} },
  ],
  buildPlan(inputs, opts): EnginePlan {
    const raw = opts.quality;
    if (raw !== undefined) {
      if (!(QUALITY as readonly string[]).includes(raw)) {
        throw new PlanError(`Unknown quality "${raw}" — choose high, medium or low.`);
      }
      const quality = raw as (typeof QUALITY)[number];
      const steps: PlanStep[] = inputs.map((_, i) => ({
        kind: "pdf-compress",
        input: `{in${String(i)}}`,
        out: `{tmp}/small-${String(i)}.pdf`,
        quality,
      }));
      const outputs: OutputSpec[] = inputs.map((input, i) => {
        const { base } = splitName(input.path);
        return {
          from: `{tmp}/small-${String(i)}.pdf`,
          baseName: `${base} (compressed)`,
          ext: "pdf",
        };
      });
      return { steps, outputs };
    }

    const rawSize = opts.targetKb;
    if (rawSize === undefined || rawSize.trim() === "") {
      throw new NeedsOptions("prompt-size");
    }
    const targetKb = Number(rawSize);
    if (!Number.isInteger(targetKb) || targetKb < 20 || targetKb > 500_000) {
      throw new PlanError(`"${rawSize}" is not a valid size in KB (try e.g. 1000).`);
    }
    const steps: PlanStep[] = inputs.map((_, i) => ({
      kind: "pdf-compress",
      input: `{in${String(i)}}`,
      out: `{tmp}/small-${String(i)}.pdf`,
      targetKb,
    }));
    const outputs = inputs.map((input, i) => {
      const { base } = splitName(input.path);
      if (input.sizeBytes > 0 && input.sizeBytes <= targetKb * 1024) {
        throw new PlanError(
          `"${base}" is already under ${String(targetKb)} KB (${Math.ceil(input.sizeBytes / 1024).toString()} KB).`,
        );
      }
      return {
        from: `{tmp}/small-${String(i)}.pdf`,
        baseName: `${base} (${String(targetKb)}KB)`,
        ext: "pdf",
      };
    });
    return { steps, outputs };
  },
};
