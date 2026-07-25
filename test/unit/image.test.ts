import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EnginePlan } from "../../src/core/plan";
import { NeedsOptions, PlanError } from "../../src/core/planError";
import { parseResizeSpec } from "../../src/core/imageSpec";
import { convertImage } from "../../src/actions/image/convert";
import { resizeImage } from "../../src/actions/image/resize";
import { compressImage } from "../../src/actions/image/compressToSize";
import { heicConvert } from "../../src/actions/image/heic";

function golden(name: string): EnginePlan {
  const url = new URL(`../golden/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as EnginePlan;
}

const PNG = { path: "C:\\pics\\photo.png", sizeBytes: 5 * 1024 * 1024 };
const JPG = { path: "C:\\pics\\photo.jpg", sizeBytes: 5 * 1024 * 1024 };
const HEIC = { path: "C:\\pics\\IMG_0042.heic", sizeBytes: 2 * 1024 * 1024 };

describe("parseResizeSpec", () => {
  it("parses the four gov-form spellings", () => {
    expect(parseResizeSpec("50%")).toEqual({ geometry: "50%" });
    expect(parseResizeSpec("800x600")).toEqual({ geometry: "800x600!" });
    expect(parseResizeSpec("800w")).toEqual({ geometry: "800" });
    expect(parseResizeSpec("600h")).toEqual({ geometry: "x600" });
    expect(parseResizeSpec("3.5x4.5cm@200dpi")).toEqual({
      geometry: "276x354!",
      densityDpi: 200,
    });
    expect(parseResizeSpec("3.5 x 4.5 cm @ 200 dpi")).toEqual({
      geometry: "276x354!",
      densityDpi: 200,
    });
  });

  it("rejects nonsense and absurd values", () => {
    expect(parseResizeSpec("banana")).toBeUndefined();
    expect(parseResizeSpec("0x0")).toBeUndefined();
    expect(parseResizeSpec("2000%")).toBeUndefined();
    expect(parseResizeSpec("1x1cm@9999dpi")).toBeUndefined();
  });
});

describe("image golden plans (I1-I4)", () => {
  it("I1 convert png->jpg flattens alpha via ffmpeg", () => {
    expect(convertImage.buildPlan([PNG], { target: "jpg" })).toEqual(golden("convert-image"));
  });

  it("I2 resize cm@dpi computes pixels and writes density", () => {
    expect(resizeImage.buildPlan([JPG], { spec: "3.5x4.5cm@200dpi" })).toEqual(
      golden("resize-image"),
    );
  });

  it("I3 compress-to-size emits a size-search step", () => {
    expect(compressImage.buildPlan([JPG], { targetKb: "50" })).toEqual(golden("compress-image"));
  });

  it("I4 heic->jpg goes through magick", () => {
    expect(heicConvert.buildPlan([HEIC], {})).toEqual(golden("heic-convert"));
  });
});

describe("image guards", () => {
  it("I1 refuses same-format conversion", () => {
    expect(() => convertImage.buildPlan([JPG], { target: "jpg" })).toThrow(/already JPG/);
  });

  it("I2/I3 open their prompt windows when options are missing", () => {
    expect(() => resizeImage.buildPlan([JPG], {})).toThrow(NeedsOptions);
    expect(() => compressImage.buildPlan([JPG], {})).toThrow(NeedsOptions);
  });

  it("I3 refuses files already under the target", () => {
    const small = { path: "C:\\pics\\small.jpg", sizeBytes: 10 * 1024 };
    expect(() => compressImage.buildPlan([small], { targetKb: "50" })).toThrow(/already under/);
  });

  it("I2 rejects an unparseable spec with examples in the message", () => {
    expect(() => resizeImage.buildPlan([JPG], { spec: "big" })).toThrow(PlanError);
  });

  it("I3 keeps transparency-capable formats in webp", () => {
    const plan = compressImage.buildPlan([PNG], { targetKb: "50" });
    const step = plan.steps[0];
    expect(step?.kind).toBe("size-search");
    if (step?.kind === "size-search") {
      expect(step.format).toBe("webp");
    }
  });
});
