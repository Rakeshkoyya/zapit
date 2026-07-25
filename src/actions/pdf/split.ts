import { splitName, type QuickAction } from "../../core/action";
import { parsePageRanges } from "../../core/pageRange";
import { NeedsOptions, PlanError } from "../../core/planError";
import type { EnginePlan, OutputSpec } from "../../core/plan";

/** P2: range grammar `1-3,7,9-` → one output PDF per comma group (§6). */
export const splitPdf: QuickAction = {
  id: "split-pdf",
  menuLabel: "Split / extract pages…",
  category: "pdf",
  extensions: ["pdf"],
  multiFile: "single",
  edition: "free",
  tier: "core",
  buildPlan(inputs, opts): EnginePlan {
    const input = inputs[0];
    if (input === undefined) {
      throw new PlanError("No input file.");
    }
    const raw = opts.ranges;
    if (raw === undefined || raw.trim() === "") {
      throw new NeedsOptions("prompt-ranges");
    }
    const groups = parsePageRanges(raw);
    if (groups === undefined) {
      throw new PlanError(`"${raw}" is not a page range — try 1-3,7,9- (pages start at 1).`);
    }
    const { base } = splitName(input.path);
    const outputs: OutputSpec[] = groups.map((g, i) => ({
      from: `{tmp}/part-${String(i)}.pdf`,
      baseName: `${base} (${g.label})`,
      ext: "pdf",
    }));
    return {
      steps: [
        {
          kind: "js",
          engine: "pdf-split",
          params: {
            input: "{in0}",
            groups: groups.map((g, i) => ({
              from: g.from,
              to: g.to ?? null,
              out: `{tmp}/part-${String(i)}.pdf`,
            })),
          },
        },
      ],
      outputs,
    };
  },
};
