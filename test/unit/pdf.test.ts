import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EnginePlan } from "../../src/core/plan";
import { NeedsOptions, PlanError } from "../../src/core/planError";
import { parsePageRanges } from "../../src/core/pageRange";
import { mergePdf } from "../../src/actions/pdf/merge";
import { splitPdf } from "../../src/actions/pdf/split";
import { compressPdf } from "../../src/actions/pdf/compress";

function golden(name: string): EnginePlan {
  const url = new URL(`../golden/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as EnginePlan;
}

const A = { path: "C:\\docs\\a.pdf", sizeBytes: 5 * 1024 * 1024 };
const B = { path: "C:\\docs\\b.pdf", sizeBytes: 3 * 1024 * 1024 };
const REPORT = { path: "C:\\docs\\report.pdf", sizeBytes: 10 * 1024 * 1024 };

describe("parsePageRanges", () => {
  it("parses the full grammar", () => {
    expect(parsePageRanges("1-3,7,9-")).toEqual([
      { from: 1, to: 3, label: "pages 1-3" },
      { from: 7, to: 7, label: "page 7" },
      { from: 9, to: undefined, label: "pages 9-end" },
    ]);
  });

  it("rejects nonsense", () => {
    expect(parsePageRanges("")).toBeUndefined();
    expect(parsePageRanges("0-3")).toBeUndefined();
    expect(parsePageRanges("5-2")).toBeUndefined();
    expect(parsePageRanges("a-b")).toBeUndefined();
    expect(parsePageRanges("1,,3")).toBeUndefined();
  });
});

describe("pdf golden plans (P1-P3)", () => {
  it("P1 merge applies the reorder window's order", () => {
    expect(mergePdf.buildPlan([A, B], { ordered: "true", order: "1,0" })).toEqual(
      golden("merge-pdf"),
    );
  });

  it("P2 split makes one output per comma group", () => {
    expect(splitPdf.buildPlan([REPORT], { ranges: "1-3,7,9-" })).toEqual(golden("split-pdf"));
  });

  it("P3 compress emits the staged pdf-compress step", () => {
    expect(compressPdf.buildPlan([REPORT], { targetKb: "1000" })).toEqual(golden("compress-pdf"));
  });
});

describe("pdf guards", () => {
  it("P1 needs two files and the reorder window", () => {
    expect(() => mergePdf.buildPlan([A], { ordered: "true" })).toThrow(/at least two/);
    expect(() => mergePdf.buildPlan([A, B], {})).toThrow(NeedsOptions);
  });

  it("P1 rejects a corrupted order", () => {
    expect(() => mergePdf.buildPlan([A, B], { ordered: "true", order: "0,0" })).toThrow(PlanError);
  });

  it("P2/P3 open their prompts when options are missing", () => {
    expect(() => splitPdf.buildPlan([REPORT], {})).toThrow(NeedsOptions);
    expect(() => compressPdf.buildPlan([REPORT], {})).toThrow(NeedsOptions);
  });

  it("P3 refuses files already under target", () => {
    const small = { path: "C:\\docs\\small.pdf", sizeBytes: 100 * 1024 };
    expect(() => compressPdf.buildPlan([small], { targetKb: "1000" })).toThrow(/already under/);
  });

  it("P3 accepts a quality level instead of a size", () => {
    for (const quality of ["high", "medium", "low"]) {
      const plan = compressPdf.buildPlan([REPORT], { quality });
      const step = plan.steps[0];
      expect(step?.kind).toBe("pdf-compress");
      if (step?.kind === "pdf-compress") {
        expect(step.quality).toBe(quality);
        // Quality mode must never also carry a size, or Rust would prefer it.
        expect(step.targetKb).toBeUndefined();
      }
      expect(plan.outputs[0]?.baseName).toBe("report (compressed)");
    }
  });

  it("P3 rejects an unknown quality level", () => {
    expect(() => compressPdf.buildPlan([REPORT], { quality: "ultra" })).toThrow(PlanError);
  });

  it("P3 quality mode does not refuse an already-small file", () => {
    // Size mode says "already under 1 MB"; quality mode has no target to
    // compare against, so it should just compress.
    const small = { path: "C:\\docs\\small.pdf", sizeBytes: 100 * 1024 };
    expect(() => compressPdf.buildPlan([small], { quality: "medium" })).not.toThrow();
  });
});
