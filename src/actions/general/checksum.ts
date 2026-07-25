import type { QuickAction } from "../../core/action";
import { PlanError } from "../../core/planError";
import type { EnginePlan, PlanStep } from "../../core/plan";

/**
 * G1: hash any file. The result lands in a window with copy + paste-to-compare
 * (constant-time), not on disk — hence no outputs.
 */
export const checksum: QuickAction = {
  id: "checksum",
  menuLabel: "Checksum",
  category: "general",
  extensions: [],
  multiFile: "single",
  edition: "free",
  tier: "extended",
  presets: [
    { label: "SHA-256", options: { algorithm: "sha256" } },
    { label: "MD5", options: { algorithm: "md5" } },
  ],
  buildPlan(inputs, opts): EnginePlan {
    if (inputs.length === 0) {
      throw new PlanError("No file selected.");
    }
    const algorithm = opts.algorithm ?? "sha256";
    if (algorithm !== "sha256" && algorithm !== "md5") {
      throw new PlanError("Choose SHA-256 or MD5.");
    }
    const steps: PlanStep[] = inputs.map((_, i) => ({
      kind: "checksum",
      input: `{in${String(i)}}`,
      algorithm,
    }));
    return { steps, outputs: [] };
  },
};
