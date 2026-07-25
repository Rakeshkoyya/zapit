import { splitName, type QuickAction } from "../../core/action";
import type { CopyStep, EnginePlan, OutputSpec } from "../../core/plan";

/**
 * M1's pipeline probe: copies each input through the temp dir and back out via
 * the standard output-move path, proving CLI → dispatch → plan → runner →
 * output → toast with zero sidecars. Not registered in any context menu later;
 * it stays as the smoke harness's canary.
 */
export const noop: QuickAction = {
  id: "noop",
  menuLabel: "Noop (test)",
  category: "general",
  extensions: [],
  multiFile: "both",
  edition: "free",
  tier: "core",
  buildPlan(inputs): EnginePlan {
    const steps: CopyStep[] = inputs.map((_input, i) => ({
      kind: "copy",
      from: `{in${String(i)}}`,
      to: `{tmp}/noop-${String(i)}`,
    }));
    const outputs: OutputSpec[] = inputs.map((input, i) => {
      const { base, ext } = splitName(input.path);
      return {
        from: `{tmp}/noop-${String(i)}`,
        baseName: `${base} (copy)`,
        ext: ext === "" ? "bin" : ext,
      };
    });
    return { steps, outputs };
  },
};
