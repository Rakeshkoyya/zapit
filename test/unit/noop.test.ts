import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noop } from "../../src/actions/general/noop";
import type { EnginePlan } from "../../src/core/plan";

/**
 * Golden-plan pattern (§12): buildPlan output is compared structurally against
 * a checked-in JSON file. Every action gets one of these.
 */
function golden(name: string): EnginePlan {
  const url = new URL(`../golden/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as EnginePlan;
}

describe("noop golden plan", () => {
  it("copies every input through temp and back out", () => {
    const plan = noop.buildPlan(
      [
        { path: "C:\\clips\\मेरा वीडियो (final) 2.mp4", sizeBytes: 123 },
        { path: "C:\\clips\\data", sizeBytes: 1 },
      ],
      {},
    );
    expect(plan).toEqual(golden("noop"));
  });
});
