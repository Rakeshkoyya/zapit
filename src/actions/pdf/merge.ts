import { splitName, type QuickAction } from "../../core/action";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan } from "../../core/plan";

/**
 * P1: multi-select → Reorder window → one PDF. The `order` option carries
 * 0-based indices from the Reorder window; `ordered=true` skips it (smoke,
 * or "just use this order").
 */
export const mergePdf: QuickAction = {
  id: "merge-pdf",
  menuLabel: "Merge PDFs",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "multi",
  edition: "free",
  tier: "core",
  buildPlan(inputs, opts): EnginePlan {
    if (inputs.length < 2) {
      throw new PlanError("Select at least two PDFs to merge.");
    }
    if (opts.ordered !== "true") {
      throw new NeedsOptions("reorder");
    }
    let order = inputs.map((_, i) => i);
    const rawOrder = opts.order;
    if (rawOrder !== undefined && rawOrder !== "") {
      const parsed = rawOrder.split(",").map((n) => Number(n.trim()));
      const valid =
        parsed.length === inputs.length &&
        parsed.every((n) => Number.isInteger(n) && n >= 0 && n < inputs.length) &&
        new Set(parsed).size === parsed.length;
      if (!valid) {
        throw new PlanError("The file order looks corrupted — try again.");
      }
      order = parsed;
    }
    const { base } = splitName(inputs[order[0] ?? 0]?.path ?? "merged");
    const out = "{tmp}/merged.pdf";
    return {
      steps: [
        {
          kind: "js",
          engine: "pdf-merge",
          params: {
            inputs: order.map((i) => `{in${String(i)}}`),
            out,
          },
        },
      ],
      outputs: [{ from: out, baseName: `${base} (merged)`, ext: "pdf" }],
    };
  },
};
